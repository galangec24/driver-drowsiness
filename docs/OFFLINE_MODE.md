# No internet in the car (store-and-forward)

**Does the Raspberry Pi need internet?**

| Part | Needs internet? |
|---|---|
| Detecting drowsiness, yawns and nods on the Pi | No |
| In-car alarm: watch vibration, buzzer / car speaker (`ALARM_CMD`) | No |
| Sending readings and alerts to the parent's dashboard / app | **Yes** (phone hotspot, pocket Wi-Fi or a 4G USB dongle) |
| Recognising which family driver sits down (`FAMILY_EMAIL`) | Yes, once per driver change |

## What happens when the connection drops

1. A reading fails to send (no connection, timeout, or the server is starting up).
2. From then on, every 1 s reading is stored in `driver_monitor/data/outbox.sqlite` instead of being
   lost, in order. When the in-car alarm sounds while offline, a camera snapshot is stored with the
   reading (at most one every 30 s).
3. Every 10 s the Pi tries to send the backlog, oldest first. The preview shows
   `OFFLINE: N readings saved, sent when online`.
4. When the connection is back, the backlog is sent with `queued: true`. The server:
   - keeps each reading's original time (up to 24 h old);
   - raises alerts for drowsy moments in the backlog, each with its own time and the snapshot;
   - marks them **delayed**: the push says *"happened 12 min ago, sent when the car was back online"*;
   - never lets an old reading overwrite the driver's newer live status.
5. Then live sending resumes.

The backlog survives the Pi being switched off (SQLite on the SD card) and is sent at the next
start. It holds about one day of readings (oldest dropped first) and drops readings older than 23 h,
which the server would no longer accept.

**Limit:** readings can only be stored for a known driver. If the car starts with no internet and
uses automatic recognition (`FAMILY_EMAIL`), the driver is recognised once the connection is back;
until then only the in-car alarm works. A fixed `DRIVER_ID` avoids this for a one-driver car.

Code: `driver_monitor/transport/outbox.py` (tests: `tests/test_outbox.py`) and
`backend/src/services/ingestService.js` (`queued`, tests: `tests/offlineBackfill.test.js`).

## Testing it

1. Start the monitor with internet; the dashboard shows the driver online.
2. Turn off the hotspot / unplug the network. Close your eyes 3 s: the in-car alarm still sounds.
   The preview shows `OFFLINE: … readings saved`.
3. Wait a minute, turn the network back on. Within ~10 s the log says
   `back online: sent N stored readings (1 alerts)` and the parent receives the alert marked delayed.
