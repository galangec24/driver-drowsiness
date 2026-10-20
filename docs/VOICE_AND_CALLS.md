# Voice guidance and parent-to-car calls

## Voice guidance (in the car)

The monitor speaks short, calm instructions when the in-car alarm changes level, greets the
recognised driver, thanks them when they are alert again, and reminds them to take a 15-minute
break after every 2 hours of driving. It works offline. Code: `driver_monitor/ui/voice.py`.

| Situation | What it says |
|---|---|
| Eyes closing / microsleep | "Your eyes have been closing. Please pull over safely and rest." |
| Head nodding | "You are nodding off. Please pull over safely and take a break." |
| Fatigue signs (yawning, slow blinks) | "You are yawning a lot. Consider taking a break soon." |
| Eyes off the road / restless | "Please keep your eyes on the road." / "Please settle down and focus on the road." |
| Back to normal | "Thank you. Stay alert and drive safely." |
| 2 hours of driving | "You have been driving for 2 hours. Please take a fifteen minute break." |

It never repeats the same sentence within 30 s or talks more often than every 8 s, except that a
more serious level speaks at once.

**Laptop (Windows):** nothing to install: it uses the built-in Windows voice.

**Raspberry Pi: natural "AI" voice with Piper (recommended)**

```bash
sudo apt install -y alsa-utils
pip install piper-tts                      # inside driver_monitor/venv
mkdir -p ~/voices && cd ~/voices
# an English voice, e.g. "en_US-amy-medium" (both files):
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

Then in `driver_monitor/.env`: `VOICE_MODEL=/home/pi/voices/en_US-amy-medium.onnx`.
Without Piper it falls back to eSpeak NG (`sudo apt install -y espeak-ng`). `VOICE=0` turns the
voice off; `VOICE_RATE` (-5..5) changes the speed; `BREAK_REMINDER_MIN` the break interval.

## Calls from the parent to the car

The parent presses **Call** on a driver (website, Windows app; the Android app opens the same call
page in the browser). The in-car device says *"<name> is calling. Answering in 3 seconds."* and
answers by itself, so the driver never touches a screen. Either side can hang up.

How it works: the backend relays only the call set-up over Socket.io (`backend/src/services/
callSignaling.js`); the audio is WebRTC, straight between the phone/browser and the car
(`driver_monitor/transport/calls.py`, `web/src/hooks/useCall.ts`). The car connects with the
ingest key and the recognised driver, so only that driver's own parents can call it.

**In-car device setup**

```bash
pip install aiortc sounddevice "python-socketio[asyncio_client]" aiohttp   # in the venv
sudo apt install -y libportaudio2                                         # Raspberry Pi
```

`CALLS=1` (default) and `CALL_AUTO_ANSWER_S=3` in `driver_monitor/.env`. Calls need the server, so
they are off with `--offline`. Use the car's speaker and a microphone near the driver; a USB
speakerphone with echo cancellation gives the clearest calls (otherwise the parent may hear an
echo of their own voice).

**Calls across mobile networks (TURN)**

Most calls connect directly. When the car is on mobile data and the parent is too, some carriers
block direct connections; a TURN relay fixes that. Create a TURN service (for example Metered.ca
or Cloudflare Calls TURN) and add on Render (Environment):

```
TURN_URLS=turn:<host>:3478,turns:<host>:5349
TURN_USERNAME=<username>
TURN_CREDENTIAL=<password>
```

The server hands these to signed-in parents and to the car for the duration of a call; nothing is
stored in the apps.
