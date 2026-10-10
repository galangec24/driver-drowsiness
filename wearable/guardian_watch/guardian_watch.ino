/*
 * Guardian Watch: wrist heart-rate sensor + vibration alert for Guardian Drive.
 *
 * Board:     Seeed Studio XIAO ESP32-C3 (any ESP32 with BLE works; adjust config.h pins)
 * Sensor:    MAX30102 pulse oximeter (I2C) on the inside of the strap, against the skin
 * Output:    vibration motor (through a MOSFET/NPN), push button to dismiss
 * Libraries: NimBLE-Arduino 2.x (h2zero), SparkFun MAX3010x Pulse and Proximity Sensor Library
 *
 * It is a standard Bluetooth LE peripheral, so it needs no wires to the car:
 *   Heart Rate Service       0x180D  Heart Rate Measurement 0x2A37 (notify, 1 Hz: HR + RR intervals
 *                                    + skin-contact bits), Body Sensor Location 0x2A38 = wrist
 *   Battery Service          0x180F  Battery Level 0x2A19 (read/notify)
 *   Immediate Alert Service  0x1802  Alert Level 0x2A06 (write): 0 off, 1 mild, 2 high → vibration
 *
 * The Raspberry Pi (driver_monitor, WEARABLE=ble) subscribes to the heart rate and writes the
 * alert level when the driver gets drowsy. Because it uses the standard profile, the Pi can also
 * use a commercial heart-rate strap instead of this watch (without the vibration).
 */
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Wire.h>

#include "MAX30105.h"  // SparkFun library; also drives the MAX30102
#include "heartRate.h"
#include "config.h"

// ------------------------------------------------------------------------------------- state
static MAX30105 sensor;
static bool sensorOk = false;

static NimBLECharacteristic* hrmChar = nullptr;
static NimBLECharacteristic* batteryChar = nullptr;
static volatile bool connected = false;

// Beat detection
static uint32_t lastBeatMs = 0;
static uint16_t rrPending[8];  // RR intervals since the last notification, in 1/1024 s
static uint8_t rrCount = 0;
static float beatRates[HR_AVERAGE_BEATS];
static uint8_t beatIdx = 0, beatFill = 0;
static bool skinContact = false;

// Vibration
static volatile uint8_t alertLevel = 0;
static volatile uint32_t alertSetMs = 0;
static uint8_t snoozedLevel = 0;
static uint32_t snoozeUntilMs = 0;

// ------------------------------------------------------------------------------------- vibration
static void setAlert(uint8_t level) {
  if (level > 2) level = 2;
  // A level the driver just dismissed stays quiet for BUTTON_SNOOZE_MS; a higher level always wins.
  if (level != 0 && level <= snoozedLevel && millis() < snoozeUntilMs) return;
  alertLevel = level;
  alertSetMs = millis();
}

// Mild: two short pulses every 3 s. High: long pulses continuously.
static void driveMotor(uint32_t now) {
  if (alertLevel != 0 && now - alertSetMs > ALERT_MAX_MS) alertLevel = 0;  // safety timeout
  bool on = false;
  if (alertLevel == 1) {
    uint32_t t = (now - alertSetMs) % 3000;
    on = t < 150 || (t >= 300 && t < 450);
  } else if (alertLevel == 2) {
    on = (now - alertSetMs) % 900 < 600;
  }
  digitalWrite(PIN_MOTOR, on ? HIGH : LOW);
}

static void pollButton(uint32_t now) {
  static bool last = true;
  static uint32_t changedMs = 0;
  bool level = digitalRead(PIN_BUTTON);  // pull-up: pressed = LOW
  if (level != last && now - changedMs > 30) {
    changedMs = now;
    last = level;
    if (!level && alertLevel != 0) {
      snoozedLevel = alertLevel;
      snoozeUntilMs = now + BUTTON_SNOOZE_MS;
      alertLevel = 0;
      Serial.println("alert dismissed by button");
    }
  }
}

// ------------------------------------------------------------------------------------- BLE
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    connected = true;
    Serial.printf("connected: %s\n", info.getAddress().toString().c_str());
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& info, int reason) override {
    connected = false;
    alertLevel = 0;  // never keep buzzing without a link to the car
    Serial.printf("disconnected (reason %d), advertising again\n", reason);
    NimBLEDevice::startAdvertising();
  }
};

class AlertCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    NimBLEAttValue v = c->getValue();
    if (v.length() >= 1) {
      setAlert(v.data()[0]);
      Serial.printf("alert level %u\n", v.data()[0]);
    }
  }
};

static void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setPower(3);  // dBm: plenty for wrist → dashboard (~1 m), saves battery

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* hrs = server->createService(NimBLEUUID((uint16_t)0x180D));
  hrmChar = hrs->createCharacteristic(NimBLEUUID((uint16_t)0x2A37), NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* location = hrs->createCharacteristic(NimBLEUUID((uint16_t)0x2A38), NIMBLE_PROPERTY::READ);
  const uint8_t wrist = 2;
  location->setValue(&wrist, 1);
  hrs->start();

  NimBLEService* bas = server->createService(NimBLEUUID((uint16_t)0x180F));
  batteryChar = bas->createCharacteristic(NimBLEUUID((uint16_t)0x2A19), NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  const uint8_t full = 100;
  batteryChar->setValue(&full, 1);
  bas->start();

  NimBLEService* ias = server->createService(NimBLEUUID((uint16_t)0x1802));
  NimBLECharacteristic* alert =
      ias->createCharacteristic(NimBLEUUID((uint16_t)0x2A06), NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::WRITE);
  alert->setCallbacks(new AlertCallbacks());
  ias->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(NimBLEUUID((uint16_t)0x180D));
  adv->enableScanResponse(true);
  adv->start();
  Serial.println("advertising as " DEVICE_NAME);
}

// ------------------------------------------------------------------------------------- heart rate
static void onSample(uint32_t ir, uint32_t now) {
  skinContact = ir > IR_CONTACT_THRESHOLD;
  if (!skinContact) {
    beatFill = 0;  // strap moved: restart averaging
    lastBeatMs = 0;
    return;
  }
  if (!checkForBeat((int32_t)ir)) return;
  if (lastBeatMs != 0) {
    uint32_t rr = now - lastBeatMs;
    if (rr >= RR_MIN_MS && rr <= RR_MAX_MS) {
      beatRates[beatIdx] = 60000.0f / rr;
      beatIdx = (beatIdx + 1) % HR_AVERAGE_BEATS;
      if (beatFill < HR_AVERAGE_BEATS) beatFill++;
      if (rrCount < 8) rrPending[rrCount++] = (uint16_t)(rr * 1024UL / 1000UL);
    }
  }
  lastBeatMs = now;
}

static uint8_t currentBpm(uint32_t now) {
  if (beatFill < 2 || lastBeatMs == 0 || now - lastBeatMs > BEAT_TIMEOUT_MS) return 0;
  float sum = 0;
  for (uint8_t i = 0; i < beatFill; i++) sum += beatRates[i];
  return (uint8_t)lroundf(sum / beatFill);
}

// Heart Rate Measurement, Bluetooth spec format: flags, uint8 HR, RR intervals (uint16, 1/1024 s).
static void notifyHeartRate(uint32_t now) {
  uint8_t buf[2 + 2 * 8];
  uint8_t bpm = currentBpm(now);
  uint8_t flags = 0x04;                  // sensor contact supported
  if (skinContact) flags |= 0x02;        // contact detected
  if (rrCount > 0) flags |= 0x10;        // RR intervals present
  size_t n = 0;
  buf[n++] = flags;
  buf[n++] = bpm;
  for (uint8_t i = 0; i < rrCount; i++) {
    buf[n++] = rrPending[i] & 0xFF;
    buf[n++] = rrPending[i] >> 8;
  }
  rrCount = 0;
  if (connected) hrmChar->notify(buf, n);
  Serial.printf("HR %u bpm  contact %d  connected %d\n", bpm, skinContact, connected);
}

static void updateBattery() {
#if PIN_BATTERY >= 0
  uint32_t mv = analogReadMilliVolts(PIN_BATTERY) * 2;  // 1:2 divider
  int pct = (int)((long)(mv - BATTERY_EMPTY_MV) * 100 / (BATTERY_FULL_MV - BATTERY_EMPTY_MV));
  uint8_t level = (uint8_t)constrain(pct, 0, 100);
  batteryChar->setValue(&level, 1);
  if (connected) batteryChar->notify();
#endif
}

// ------------------------------------------------------------------------------------- main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_MOTOR, OUTPUT);
  digitalWrite(PIN_MOTOR, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  Wire.begin(PIN_SDA, PIN_SCL);
  sensorOk = sensor.begin(Wire, I2C_SPEED_FAST);
  if (sensorOk) {
    // 0x1F LED power, 4-sample averaging, Red+IR (MAX30102 has no green), 400 Hz → 100 samples/s
    sensor.setup(0x1F, 4, 2, 400, 411, 4096);
    sensor.setPulseAmplitudeRed(0x0A);  // red only as an indicator; beats come from IR
  } else {
    Serial.println("MAX30102 not found: check SDA/SCL wiring and 3.3 V");
  }

  setupBle();
  updateBattery();

  // Short buzz = powered on and ready.
  digitalWrite(PIN_MOTOR, HIGH);
  delay(120);
  digitalWrite(PIN_MOTOR, LOW);
}

void loop() {
  static uint32_t lastNotify = 0, lastBattery = 0;
  uint32_t now = millis();

  if (sensorOk) {
    sensor.check();
    while (sensor.available()) {
      onSample(sensor.getFIFOIR(), millis());
      sensor.nextSample();
    }
  }

  if (now - lastNotify >= NOTIFY_INTERVAL_MS) {
    lastNotify = now;
    notifyHeartRate(now);
  }
  if (now - lastBattery >= BATTERY_INTERVAL_MS) {
    lastBattery = now;
    updateBattery();
  }

  pollButton(now);
  driveMotor(now);
}
