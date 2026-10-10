// Guardian Watch — build-time settings. See docs/WEARABLE.md.
#pragma once

// Advertised Bluetooth name. Must match WEARABLE_NAME in driver_monitor/.env.
#define DEVICE_NAME "GuardianWatch"

// ---- Pins: Seeed Studio XIAO ESP32-C3 (change for other ESP32 boards) ----
#define PIN_SDA 6        // D4 -> MAX30102 SDA
#define PIN_SCL 7        // D5 -> MAX30102 SCL
#define PIN_MOTOR 4      // D2 -> gate of the motor MOSFET / base resistor of the NPN
#define PIN_BUTTON 3     // D1 -> push button to GND (driver dismisses a vibration)
#define PIN_BATTERY 2    // A0 -> middle of a 2 x 220 kOhm divider from BAT+ (set -1 if not fitted)

// ---- Sensor ----
// Raw IR level above which the sensor is touching skin. Wrist readings are lower than the
// fingertip values in the SparkFun examples (50 000); check the serial log while wearing it.
#define IR_CONTACT_THRESHOLD 30000UL
// Beats accepted only between 40 and 200 bpm (RR 300..1500 ms).
#define RR_MIN_MS 300
#define RR_MAX_MS 1500
// Heart rate is averaged over this many recent beats.
#define HR_AVERAGE_BEATS 6
// No beat for this long → report "no reading" (HR 0) instead of a stale number.
#define BEAT_TIMEOUT_MS 4000

// ---- Timing ----
#define NOTIFY_INTERVAL_MS 1000      // one Heart Rate Measurement per second (like the camera)
#define BATTERY_INTERVAL_MS 60000
#define ALERT_MAX_MS 60000           // a vibration stops by itself after 60 s without a new command
#define BUTTON_SNOOZE_MS 20000       // after the driver presses the button, the same level stays quiet

// Battery voltage → percent (single-cell LiPo)
#define BATTERY_EMPTY_MV 3300
#define BATTERY_FULL_MV 4150
