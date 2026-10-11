import { useEffect, useRef, useState } from 'react';
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { analyzeSource, ISSUE_TEXT, toJpegDataUrl, type QualityReport } from '../../lib/imageQuality';
import { loadFaceDetector } from '../../lib/faceDetector';
import {
  checkPosition,
  ovalFor,
  videoBoxToDisplay,
  yawFromKeypoints,
  type Oval,
  type PositionIssue,
} from '../../lib/facePosition';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

export interface CameraCaptureProps {
  angle: string;
  onCapture: (dataUrl: string, quality: QualityReport | null) => void;
  onClose: () => void;
  /**
   * Check a shot before it is accepted (e.g. on the server: one face, same person as the front
   * photo). Resolve with an error message to reject it: the camera stays open and retakes.
   */
  validate?: (dataUrl: string) => Promise<string | null>;
}

/** The photo is taken automatically once face position, lighting and focus stay good this long. */
export const HOLD_MS = 5000;
const REJECT_PAUSE_MS = 3000;
const TICK_MS = 200;

type DetectorState = 'loading' | 'ready' | 'unavailable';

/** The oval as an SVG path that starts at the top and runs clockwise (the countdown ring fills from there). */
function ovalPath({ cx, cy, rx, ry }: Oval): string {
  return `M${cx} ${cy - ry}A${rx} ${ry} 0 1 1 ${cx} ${cy + ry}A${rx} ${ry} 0 1 1 ${cx} ${cy - ry}Z`;
}

const POSITION_TEXT: Record<PositionIssue, string> = {
  no_face: 'Move closer and put your face inside the oval',
  multiple_faces: 'Only one face in the frame',
  face_too_small: 'Move closer to the camera',
  face_too_big: 'Move a little farther away',
  off_center: 'Center your face in the oval',
  look_straight: 'Look straight at the camera',
  turn_head: 'Turn your head a little to the side',
};

/**
 * Full-screen selfie viewfinder with a large face guide. A small in-browser face detector checks
 * that one face is centred in the oval at the right distance; together with the lighting/focus check
 * this counts down and captures by itself. "Capture" still works at any time (and is the only way
 * if the detector cannot load, e.g. offline).
 */
export function CameraCapture({ angle, onCapture, onClose, validate }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const holdStart = useRef<number | null>(null);
  const captured = useRef(false);
  // After a rejected shot, wait a moment so the reason can be read before the next countdown.
  const pauseUntil = useRef(0);
  const latest = useRef({ angle, onCapture, validate, size: { W: 0, H: 0 } });
  latest.current.angle = angle;
  latest.current.onCapture = onCapture;
  latest.current.validate = validate;

  const [error, setError] = useState('');
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [position, setPosition] = useState<PositionIssue[] | null>(null);
  const [detector, setDetector] = useState<DetectorState>('loading');
  const [progress, setProgress] = useState(0);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState('');

  // A new angle (front → left → right) starts its own countdown.
  useEffect(() => {
    holdStart.current = null;
    captured.current = false;
    setProgress(0);
    setRejected('');
  }, [angle]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const measure = () => {
      const s = { W: el.clientWidth, H: el.clientHeight };
      latest.current.size = s;
      setSize(s);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadFaceDetector()
      .then((d) => {
        if (!alive) return;
        detectorRef.current = d;
        setDetector('ready');
      })
      .catch(() => alive && setDetector('unavailable'));
    return () => {
      alive = false;
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || captured.current) return;
    captured.current = true; // pauses auto-capture while this shot is checked
    holdStart.current = null;
    setProgress(0);
    setRejected('');
    const q = analyzeSource(video, video.videoWidth, video.videoHeight);
    const dataUrl = toJpegDataUrl(video, video.videoWidth, video.videoHeight, { mirror: true });
    const check = latest.current.validate;
    if (!check) {
      latest.current.onCapture(dataUrl, q);
      return;
    }
    const forAngle = latest.current.angle;
    setChecking(true);
    check(dataUrl)
      .then((problem) => {
        if (latest.current.angle !== forAngle) return;
        if (problem) {
          setRejected(problem);
          pauseUntil.current = Date.now() + REJECT_PAUSE_MS;
          captured.current = false; // stay open: the countdown starts again
        } else {
          latest.current.onCapture(dataUrl, q);
        }
      })
      .catch(() => {
        setRejected('Could not check the photo. Check your connection and try again.');
        pauseUntil.current = Date.now() + REJECT_PAUSE_MS;
        captured.current = false;
      })
      .finally(() => setChecking(false));
  }
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    function tick() {
      const video = videoRef.current;
      if (!video || !video.videoWidth || video.readyState < 2) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const q = analyzeSource(video, vw, vh);
      setQuality(q);

      const { W, H } = latest.current.size;
      let issues: PositionIssue[] | null = null;
      if (detectorRef.current && W && H) {
        try {
          const res = detectorRef.current.detectForVideo(video, performance.now());
          const faces = res.detections.flatMap((d) =>
            d.boundingBox
              ? [
                  {
                    box: videoBoxToDisplay(
                      {
                        x: d.boundingBox.originX,
                        y: d.boundingBox.originY,
                        w: d.boundingBox.width,
                        h: d.boundingBox.height,
                      },
                      vw,
                      vh,
                      W,
                      H,
                    ),
                    yaw: yawFromKeypoints(d.keypoints),
                  },
                ]
              : [],
          );
          issues = checkPosition(faces, ovalFor(W, H), latest.current.angle);
        } catch {
          issues = null;
        }
      }
      setPosition(issues);

      const good =
        Boolean(q?.ok) &&
        issues !== null &&
        issues.length === 0 &&
        !captured.current &&
        Date.now() >= pauseUntil.current;
      if (!good) {
        holdStart.current = null;
        setProgress(0);
        return;
      }
      const now = Date.now();
      holdStart.current ??= now;
      const p = Math.min(1, (now - holdStart.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) captureRef.current();
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available in this browser');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = window.setInterval(tick, TICK_MS);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open the camera');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const hint =
    angle === 'front'
      ? 'Look straight at the camera'
      : angle === 'left'
        ? 'Turn your head slightly left'
        : 'Turn your head slightly right';

  const oval = size.W && size.H ? ovalFor(size.W, size.H) : null;
  const ready = progress > 0;
  const secondsLeft = Math.max(1, Math.ceil(((1 - progress) * HOLD_MS) / 1000));
  const messages = [
    ...(position ?? []).map((i) =>
      i === 'turn_head' && angle !== 'front' ? `Turn your head slightly ${angle}` : POSITION_TEXT[i],
    ),
    ...(quality?.issues ?? []).map((i) => ISSUE_TEXT[i] ?? i),
  ].slice(0, 2);

  return (
    <div
      className="fixed inset-0 z-40 flex bg-black sm:items-center sm:justify-center sm:bg-black/70 sm:p-4 sm:backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${angle} photo`}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-ink-900 sm:h-auto sm:max-w-xl sm:rounded-2xl sm:border sm:border-white/10 sm:shadow-depth-3">
        <div ref={frameRef} className="relative min-h-0 flex-1 bg-black sm:aspect-[4/3] sm:flex-none">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-red-200">{error}</div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              />
              {oval && (
                <svg
                  data-testid="face-guide"
                  className="pointer-events-none absolute inset-0"
                  width={size.W}
                  height={size.H}
                  aria-hidden="true"
                >
                  {/* Dim everything outside the oval (screen rectangle with the oval cut out). */}
                  <path
                    d={`M0 0H${size.W}V${size.H}H0Z ${ovalPath(oval)}`}
                    fillRule="evenodd"
                    fill="rgba(0,0,0,0.55)"
                  />
                  <ellipse
                    cx={oval.cx}
                    cy={oval.cy}
                    rx={oval.rx}
                    ry={oval.ry}
                    fill="none"
                    strokeWidth={4}
                    strokeDasharray={ready ? undefined : '14 10'}
                    className={`transition-colors ${ready ? 'stroke-accent-ok/60' : 'stroke-white/70'}`}
                  />
                  {ready && (
                    <path
                      data-testid="capture-progress"
                      d={ovalPath(oval)}
                      fill="none"
                      strokeWidth={8}
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray={`${progress * 100} 100`}
                      className="stroke-accent-ok"
                    />
                  )}
                </svg>
              )}
              <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))] text-center">
                <p className="text-lg font-bold capitalize text-white">{angle} photo</p>
                <p className="text-sm text-white/85">{hint}</p>
              </div>
              <div
                className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-4"
                aria-live="polite"
              >
                {rejected && !checking && (
                  <span
                    role="alert"
                    data-testid="shot-rejected"
                    className="max-w-sm rounded-2xl bg-accent-danger/40 px-4 py-1.5 text-center text-sm font-semibold text-red-50"
                  >
                    Photo not accepted: {rejected}
                  </span>
                )}
                {checking ? (
                  <span
                    data-testid="shot-checking"
                    className="flex items-center gap-2 rounded-full bg-accent-primary/40 px-4 py-1.5 text-sm font-bold text-indigo-50"
                  >
                    <Spinner size={14} /> Checking the photo…
                  </span>
                ) : ready ? (
                  <span className="rounded-full bg-accent-ok/30 px-4 py-1.5 text-sm font-bold text-emerald-100">
                    Hold still… capturing in {secondsLeft}
                  </span>
                ) : (
                  messages.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-accent-warn/30 px-4 py-1.5 text-sm font-semibold text-amber-100"
                    >
                      {m}
                    </span>
                  ))
                )}
                {detector === 'loading' && <span className="text-xs text-white/70">Getting the face guide ready…</span>}
                {detector === 'unavailable' && (
                  <span className="text-xs text-white/70">Auto-capture unavailable: tap Capture when ready</span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="hidden text-xs text-ink-muted sm:block">
            Captures automatically when your face is in position.
          </p>
          <div className="ml-auto flex gap-2">
            <DepthButton variant="ghost" onClick={onClose}>
              Cancel
            </DepthButton>
            <DepthButton
              icon={<Icon name="camera" size={18} />}
              onClick={capture}
              disabled={Boolean(error) || checking}
            >
              Capture
            </DepthButton>
          </div>
        </div>
      </div>
    </div>
  );
}
