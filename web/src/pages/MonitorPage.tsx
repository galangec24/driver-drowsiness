/**
 * TESTING PHASE: the driver monitor in a phone's browser, opened from a parent's monitor link
 * (/monitor/<secret>). It runs the same detectors as the in-car device (lib/monitor/, ported from
 * driver_monitor/) and makes the same calls: a reading every second, the alert photo, "away from
 * the car", the in-car voice and alarm. Remove with DRIVER_MONITOR_WEB.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { MonitorLinkError, monitorDevice, type MonitorSession } from '../api/monitor';
import { MonitorEngine, type FrameResult, type GeoFix } from '../lib/monitor/engine';
import { poseFromMatrix, type Pt } from '../lib/monitor/detectors';
import { HIGH, InCarAlarm, MILD } from '../lib/monitor/fuzzy';
import { VoiceGuide, beep, speak, unlockSound } from '../lib/monitor/voice';
import { loadLandmarker } from '../lib/monitor/landmarker';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';

const FRAME_MS = 100; // ~10 analysed frames a second, like the in-car monitor
const POST_MS = 1000; // one reading a second
const AWAY_AFTER_S = 20; // seat empty this long: "Away from the car"
const AWAY_PING_S = 15;
const AWAY_MAX_S = 30 * 60;
const PHOTO_WIDTH = 560;

type Phase = 'loading' | 'ready' | 'starting' | 'running' | 'error';

interface Evidence {
  ear: number;
  canvas: HTMLCanvasElement;
  box: NonNullable<FrameResult['box']>;
}

const LEVEL_TEXT = ['Alert', 'Fatigue signs', 'Drowsy'];
const LEVEL_CLASS = [
  'bg-emerald-500/20 text-emerald-100',
  'bg-amber-400/25 text-amber-100',
  'bg-red-500/30 text-red-100',
];

/** Head-and-shoulders crop of a frame, brightened a little, as a JPEG data URL. */
function alertPhoto(source: HTMLCanvasElement | HTMLVideoElement, box: Evidence['box'] | null): string {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  let x = 0;
  let y = 0;
  let w = sw;
  let h = sh;
  if (box) {
    const cx = box.x + box.w / 2;
    w = Math.min(sw, box.w * 2.2);
    h = Math.min(sh, box.h * 2.4);
    x = Math.max(0, Math.min(sw - w, cx - w / 2));
    y = Math.max(0, Math.min(sh - h, box.y - box.h * 0.5));
  }
  const scale = Math.min(1, PHOTO_WIDTH / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext('2d')!;
  ctx.filter = 'contrast(1.1) brightness(1.05)';
  ctx.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.9);
}

export function MonitorPage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [session, setSession] = useState<MonitorSession | null>(null);
  const [frame, setFrame] = useState<FrameResult | null>(null);
  const [level, setLevel] = useState(0);
  const [server, setServer] = useState<{ status: string; ok: boolean }>({ status: '—', ok: true });
  const [gps, setGps] = useState<GeoFix | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [away, setAway] = useState(false);
  const [lastAlert, setLastAlert] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<() => void>(() => {});

  // Who is this link for?
  useEffect(() => {
    let cancelled = false;
    monitorDevice
      .session(token)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof MonitorLinkError && err.status === 401
            ? `${err.message}. Ask the parent for a new link.`
            : 'Could not reach the server. Check the internet connection and reload.',
        );
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => () => stopRef.current(), []);

  const start = useCallback(async () => {
    if (!session) return;
    unlockSound(); // inside the tap: browsers allow sound only after the user acts
    setPhase('starting');
    let stream: MediaStream;
    let landmarker: FaceLandmarker;
    try {
      [stream, landmarker] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
        loadLandmarker(),
      ]);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this site and try again.'
          : 'Could not start the camera or load the face model. Reload and try again.',
      );
      setPhase('error');
      return;
    }
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play().catch(() => {});

    // Keep the screen on while monitoring.
    let wakeLock: WakeLockSentinel | null = null;
    const lockScreen = () =>
      navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          wakeLock = l;
        })
        .catch(() => {});
    void lockScreen();
    const onVisible = () => document.visibilityState === 'visible' && void lockScreen();
    document.addEventListener('visibilitychange', onVisible);

    // GPS (the drive distance, the alert location, "parked").
    let fix: GeoFix | null = null;
    const geoWatch = navigator.geolocation?.watchPosition(
      (p) => {
        fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          ...(typeof p.coords.speed === 'number' && p.coords.speed >= 0 && { speed: p.coords.speed * 3.6 }),
          ...(typeof p.coords.heading === 'number' && !Number.isNaN(p.coords.heading) && { heading: p.coords.heading }),
        };
        setGps(fix);
        setGpsError('');
      },
      () => setGpsError('Location is off: alerts will have no map or distance.'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );

    const engine = new MonitorEngine(session.driver.id);
    engine.applyThresholds(session.personalThresholds, session.device.yawnMar);
    const voice = new VoiceGuide(speak);
    const alarm = new InCarAlarm((lv, reason) => {
      beep(lv);
      voice.onAlert(lv, reason || alarm.reasonNow, performance.now() / 1000);
      setLevel(lv);
    });
    alarm.applyThresholds(session.personalThresholds);
    voice.greet(session.driver.name, performance.now() / 1000);

    // Alert photo: the sharpest most-closed-eye frame of the last ~3 readings.
    const evidence: (Evidence | null)[] = [null, null, null];
    const grab = document.createElement('canvas');
    let last: FrameResult | null = null;
    let lastVideoTime = -1;
    let faceSeenAt: number | null = null;
    let nextAwayPing = 0;
    let posting = false;

    const analyse = () => {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const t = performance.now() / 1000;
      const w = video.videoWidth;
      const h = video.videoHeight;
      const res = landmarker.detectForVideo(video, performance.now());
      let landmarks: Pt[] | null = null;
      let pose = null;
      if (res.faceLandmarks.length) {
        const faces = res.faceLandmarks.map((f) => f.map((p) => ({ x: p.x * w, y: p.y * h })));
        const area = (f: Pt[]) => {
          const xs = f.map((p) => p.x);
          const ys = f.map((p) => p.y);
          return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        };
        let best = 0;
        faces.forEach((f, i) => {
          if (area(f) > area(faces[best]!)) best = i;
        });
        landmarks = faces[best]!;
        const m = res.facialTransformationMatrixes?.[best]?.data;
        if (m) pose = poseFromMatrix(m);
      }
      const r = engine.process({ landmarks, pose, width: w, height: h }, t);
      last = r;
      if (r.face) faceSeenAt = t;
      if (r.ear !== null && r.eyesReliable && r.box && (!evidence[0] || r.ear < evidence[0].ear)) {
        grab.width = w;
        grab.height = h;
        grab.getContext('2d')!.drawImage(video, 0, 0, w, h);
        const copy = evidence[0]?.canvas ?? document.createElement('canvas');
        copy.width = w;
        copy.height = h;
        copy.getContext('2d')!.drawImage(grab, 0, 0);
        evidence[0] = { ear: r.ear, canvas: copy, box: r.box };
      }
      alarm.onFrame(
        {
          closedForS: r.closedForS,
          perclos: engine.perclos.effective(t),
          nodded: r.nodded,
          awayForS: r.awayForS,
          restless: r.restless,
          fatigue: r.fatigue.score,
          fatigueReason: r.fatigue.reason,
        },
        t,
      );
      setFrame(r);
    };

    const post = async () => {
      const t = performance.now() / 1000;
      const seatEmpty = faceSeenAt !== null && t - faceSeenAt >= AWAY_AFTER_S && t - faceSeenAt <= AWAY_MAX_S;
      setAway(seatEmpty);
      if (posting) return;
      posting = true;
      try {
        if (seatEmpty) {
          if (t >= nextAwayPing) {
            nextAwayPing = t + AWAY_PING_S;
            await monitorDevice.away(token);
            setServer({ status: 'away', ok: true });
          }
          return;
        }
        if (faceSeenAt === null) return; // nobody seen yet: nothing to report
        const payload = engine.payload(t, fix);
        const fatigueAlert = (last?.closedForS ?? 0) > 0 || engine.fatigue.level > 0;
        const kept = evidence.find((e) => e) ?? null;
        evidence.unshift(null);
        evidence.length = 3;
        const resp = await monitorDevice.ingest(token, payload);
        alarm.onBackend(resp.classification, performance.now() / 1000);
        setServer({ status: resp.classification, ok: true });
        if (resp.alertTriggered && resp.alertId) {
          setLastAlert(new Date().toLocaleTimeString());
          const photo = fatigueAlert && kept ? alertPhoto(kept.canvas, kept.box) : alertPhoto(video, last?.box ?? null);
          void monitorDevice.snapshot(token, resp.alertId, photo).catch(() => {});
        }
      } catch (err) {
        if (err instanceof MonitorLinkError && err.status === 401) {
          setError(`${err.message}. Monitoring stopped.`);
          stopRef.current();
          setPhase('error');
          return;
        }
        setServer((s) => ({ ...s, ok: false }));
      } finally {
        posting = false;
      }
    };

    const frameTimer = window.setInterval(analyse, FRAME_MS);
    const postTimer = window.setInterval(() => void post(), POST_MS);
    stopRef.current = () => {
      window.clearInterval(frameTimer);
      window.clearInterval(postTimer);
      if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock?.release().catch(() => {});
      stream.getTracks().forEach((tr) => tr.stop());
      window.speechSynthesis?.cancel();
      stopRef.current = () => {};
    };
    setPhase('running');
  }, [session, token]);

  const stop = () => {
    stopRef.current();
    setPhase('ready');
    setLevel(0);
    setFrame(null);
  };

  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-6 text-white">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header className="flex items-center gap-3">
          <Icon name="eye" size={26} className="text-accent-glow" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold">Driver monitor</h1>
            <p className="text-xs text-ink-muted">
              {session ? `Watching ${session.driver.name}` : 'Guardian Drive'} · testing version
            </p>
          </div>
          {phase === 'running' && (
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${LEVEL_CLASS[level]}`}
              data-testid="monitor-level"
            >
              {LEVEL_TEXT[level]}
            </span>
          )}
        </header>

        {phase === 'loading' && (
          <div className="flex justify-center py-16">
            <Spinner size={32} />
          </div>
        )}

        {phase === 'error' && (
          <div role="alert" className="rounded-2xl bg-red-500/15 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {(phase === 'ready' || phase === 'starting') && session && (
          <section className="flex flex-col gap-3 rounded-2xl bg-white/5 p-4 text-sm">
            <p className="text-base font-semibold">Hello {session.driver.name}.</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
              <li>Mount the phone on the dashboard, front camera facing you, about an arm’s length away.</li>
              <li>Plug it in to charge, and turn the volume up: the phone speaks and beeps to warn you.</li>
              <li>Allow the camera and location when asked.</li>
              <li>Keep this page open and the screen on while driving.</li>
            </ol>
            <p className="text-xs text-ink-muted">
              Readings go to your family’s Guardian Drive account. Video is analysed on this phone and is not uploaded;
              only a photo is sent with an alert.
            </p>
            <DepthButton
              icon={<Icon name="camera" size={18} />}
              loading={phase === 'starting'}
              onClick={() => void start()}
            >
              Start monitoring
            </DepthButton>
          </section>
        )}

        <div className={phase === 'running' ? 'flex flex-col gap-3' : 'hidden'}>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
            <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full -scale-x-100 object-cover" />
            {frame && !frame.face && (
              <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-sm">
                {away ? 'Away from the car' : 'No face: look at the camera'}
              </p>
            )}
            {level >= MILD && (
              <p
                className={`absolute inset-x-0 top-0 px-3 py-2 text-center text-sm font-bold ${
                  level >= HIGH ? 'bg-red-600/85' : 'bg-amber-500/85'
                }`}
              >
                {level >= HIGH ? 'Wake up! Pull over safely.' : 'Signs of fatigue: consider a break.'}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ['Eyes open', frame?.ear !== null && frame?.ear !== undefined ? frame.ear.toFixed(2) : '—'],
              ['Eyes closed', pct(frame?.perclos)],
              ['Fatigue', pct(frame?.fatigue.score)],
              ['Server', server.ok ? server.status : 'offline'],
              ['GPS', gps ? `${typeof gps.speed === 'number' ? `${Math.round(gps.speed)} km/h` : 'on'}` : '…'],
              ['Last alert', lastAlert || '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-2 py-2">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {frame?.fatigue.reason && frame.fatigue.level > 0 && (
            <p className="text-center text-sm text-amber-100">{frame.fatigue.reason}</p>
          )}
          {gpsError && <p className="text-center text-xs text-amber-300">{gpsError}</p>}
          <DepthButton variant="secondary" onClick={stop}>
            Stop monitoring
          </DepthButton>
        </div>
      </div>
    </div>
  );
}
