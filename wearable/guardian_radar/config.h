// Guardian Radar — dashboard-mounted contactless vital-signs unit. See docs/WEARABLE.md.
#pragma once

// Advertised Bluetooth name. Must match VITALS_NAME in driver_monitor/.env.
#define DEVICE_NAME "GuardianRadar"

// Only a person closer than this counts as "the driver" (ignores the back seat). The library
// reports distance in centimetres; measure dashboard-to-chest in your car and add ~20 cm.
#define MAX_DRIVER_DISTANCE_CM 110.0f

// Plausible ranges for a seated adult. Outside → treated as no reading.
#define HR_MIN 40.0f
#define HR_MAX 180.0f
#define BREATH_MIN 4.0f
#define BREATH_MAX 40.0f

// Median of the last N radar readings (the raw values jump when the car shakes).
#define SMOOTH_N 5
// No valid reading for this long → report 0 ("no reading") instead of an old value.
#define STALE_MS 5000

#define NOTIFY_INTERVAL_MS 1000

// The Seeed kit has a WS2812 status LED on D1 (needs the Adafruit NeoPixel library). 0 = no LED.
#define USE_STATUS_LED 1
#define PIN_STATUS_LED D1
