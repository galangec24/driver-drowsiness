# wearable/: in-car Bluetooth sensors

| Folder | Device | Role |
|---|---|---|
| `guardian_radar/` | Seeed MR60BHA2 60 GHz radar kit (XIAO ESP32-C6) | **Recommended.** Dashboard-mounted, contactless heart rate + breathing |
| `guardian_watch/` | XIAO ESP32-C3 + MAX30102 + vibration motor | Optional wrist unit: beat-to-beat HR (HRV) + vibration alert |

Both talk to the Raspberry Pi over Bluetooth LE (no wires). Design, costs, wiring, flashing and
testing: **[docs/WEARABLE.md](../docs/WEARABLE.md)**.
