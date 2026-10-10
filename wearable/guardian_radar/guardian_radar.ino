/*
 * Guardian Radar: contactless heart rate + breathing from the dashboard, sent over Bluetooth LE.
 *
 * Hardware:  Seeed Studio MR60BHA2 60 GHz mmWave kit (radar + XIAO ESP32-C6 on one board).
 *            Mount on the dashboard / steering column facing the driver's chest, 0.5–1 m away,
 *            behind plastic only (60 GHz does not pass through metal). Power: any USB port.
 * Libraries: Seeed Arduino mmWave (Seeed-Projects/Seeed-mmWave-library), NimBLE-Arduino 2.x,
 *            Adafruit NeoPixel (status LED, optional)
 *
 * Bluetooth profile (the Raspberry Pi is the central, no cables):
 *   Heart Rate Service 0x180D / Heart Rate Measurement 0x2A37 (notify 1 Hz)
 *       standard format, so driver_monitor reads it exactly like the watch or a commercial strap.
 *       "Sensor contact" bit = a person is detected within MAX_DRIVER_DISTANCE_CM.
 *   Guardian Vitals service (custom 128-bit) / Vitals characteristic (notify 1 Hz), 5 bytes LE:
 *       uint16 breathing rate ×10 (breaths/min, 0 = none) · uint16 distance cm · uint8 flags (bit0 present)
 */
#include <Arduino.h>
#include <NimBLEDevice.h>

#include "Seeed_Arduino_mmWave.h"
#include "config.h"

#if USE_STATUS_LED
#include <Adafruit_NeoPixel.h>
static Adafruit_NeoPixel led(1, PIN_STATUS_LED, NEO_GRB + NEO_KHZ800);
#endif

// Shared with driver_monitor/sensors/ble_wearable.py
#define VITALS_SERVICE_UUID "6e0f0001-8c3b-4b8e-9a6e-6a5f3c1d0a01"
#define VITALS_CHAR_UUID "6e0f0002-8c3b-4b8e-9a6e-6a5f3c1d0a01"

#ifdef ESP32
#include <HardwareSerial.h>
static HardwareSerial mmWaveSerial(0);  // the kit wires the radar to the C6's UART0
#else
#define mmWaveSerial Serial1
#endif

static SEEED_MR60BHA2 radar;
static NimBLECharacteristic* hrmChar = nullptr;
static NimBLECharacteristic* vitalsChar = nullptr;
static volatile bool connected = false;

// ------------------------------------------------------------------------------------- smoothing
struct Median {
  float v[SMOOTH_N];
  uint8_t n = 0, i = 0;
  uint32_t lastMs = 0;
  void add(float x, uint32_t now) {
    v[i] = x;
    i = (i + 1) % SMOOTH_N;
    if (n < SMOOTH_N) n++;
    lastMs = now;
  }
  float get(uint32_t now) const {
    if (n == 0 || now - lastMs > STALE_MS) return 0;
    float s[SMOOTH_N];
    memcpy(s, v, sizeof(float) * n);
    for (uint8_t a = 1; a < n; a++)  // insertion sort, n ≤ 5
      for (uint8_t b = a; b > 0 && s[b - 1] > s[b]; b--) std::swap(s[b - 1], s[b]);
    return s[n / 2];
  }
  void clear() { n = 0; }
};

static Median heart, breath;
static float distanceCm = 0;
static bool present = false;

// ------------------------------------------------------------------------------------- BLE
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    connected = true;
    Serial.printf("connected: %s\n", info.getAddress().toString().c_str());
  }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& info, int reason) override {
    connected = false;
    Serial.printf("disconnected (reason %d), advertising again\n", reason);
    NimBLEDevice::startAdvertising();
  }
};

static void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* hrs = server->createService(NimBLEUUID((uint16_t)0x180D));
  hrmChar = hrs->createCharacteristic(NimBLEUUID((uint16_t)0x2A37), NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* location = hrs->createCharacteristic(NimBLEUUID((uint16_t)0x2A38), NIMBLE_PROPERTY::READ);
  const uint8_t chest = 1;  // radar senses chest wall motion
  location->setValue(&chest, 1);
  hrs->start();

  NimBLEService* vitals = server->createService(VITALS_SERVICE_UUID);
  vitalsChar = vitals->createCharacteristic(VITALS_CHAR_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  vitals->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(NimBLEUUID((uint16_t)0x180D));
  adv->enableScanResponse(true);
  adv->start();
  Serial.println("advertising as " DEVICE_NAME);
}

static void notifyAll(uint32_t now) {
  float hr = present ? heart.get(now) : 0;
  float br = present ? breath.get(now) : 0;

  // Heart Rate Measurement: flags (contact supported | detected), uint8 bpm. No RR intervals:
  // radar heart rate is a frequency estimate, not individual beats (so no HRV from this unit).
  uint8_t hrm[2] = {(uint8_t)(0x04 | (present ? 0x02 : 0)), (uint8_t)lroundf(hr)};

  uint16_t br10 = (uint16_t)lroundf(br * 10);
  uint16_t dist = (uint16_t)lroundf(distanceCm);
  uint8_t vit[5] = {(uint8_t)(br10 & 0xFF), (uint8_t)(br10 >> 8), (uint8_t)(dist & 0xFF), (uint8_t)(dist >> 8),
                    (uint8_t)(present ? 1 : 0)};
  vitalsChar->setValue(vit, sizeof(vit));
  if (connected) {
    hrmChar->notify(hrm, sizeof(hrm));
    vitalsChar->notify();
  }
  Serial.printf("HR %.0f  breath %.1f  dist %.0f cm  present %d  connected %d\n", hr, br, distanceCm, present,
                connected);

#if USE_STATUS_LED
  // green = streaming to the Pi, blue = waiting for the Pi, red = no driver in range
  uint32_t c = !present ? led.Color(60, 0, 0) : connected ? led.Color(0, 60, 0) : led.Color(0, 0, 60);
  led.setPixelColor(0, c);
  led.show();
#endif
}

// ------------------------------------------------------------------------------------- main
void setup() {
  Serial.begin(115200);
  radar.begin(&mmWaveSerial);
#if USE_STATUS_LED
  led.begin();
  led.setBrightness(10);
#endif
  setupBle();
}

void loop() {
  static uint32_t lastNotify = 0;
  uint32_t now = millis();

  if (radar.update(100)) {
    float v;
    if (radar.getDistance(v)) {
      distanceCm = v;
      bool wasPresent = present;
      present = v > 0 && v <= MAX_DRIVER_DISTANCE_CM;
      if (wasPresent && !present) {  // driver left the seat: don't carry their values over
        heart.clear();
        breath.clear();
      }
    }
    if (present && radar.getHeartRate(v) && v >= HR_MIN && v <= HR_MAX) heart.add(v, now);
    if (present && radar.getBreathRate(v) && v >= BREATH_MIN && v <= BREATH_MAX) breath.add(v, now);
  }

  if (now - lastNotify >= NOTIFY_INTERVAL_MS) {
    lastNotify = now;
    notifyAll(now);
  }
}
