import { useEffect, useRef, useState } from 'react';
import { analyzeSource, ISSUE_TEXT, toJpegDataUrl, type QualityReport } from '../../lib/imageQuality';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

export interface CameraCaptureProps {
  angle: string;
  onCapture: (dataUrl: string, quality: QualityReport | null) => void;
  onClose: () => void;
}

/** getUserMedia viewfinder with live blur/lighting feedback. */
export function CameraCapture({ angle, onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<QualityReport | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

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
        timer = window.setInterval(() => {
          setQuality(analyzeSource(video, video.videoWidth, video.videoHeight));
        }, 400);
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

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const q = analyzeSource(video, video.videoWidth, video.videoHeight);
    onCapture(toJpegDataUrl(video, video.videoWidth, video.videoHeight, { mirror: true }), q);
  }

  const hint =
    angle === 'front' ? 'Look straight at the camera' : angle === 'left' ? 'Turn your head slightly left' : 'Turn your head slightly right';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="glass w-full max-w-2xl overflow-hidden bg-ink-900/90 shadow-depth-3">
        <div className="relative aspect-video bg-black">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-red-200">{error}</div>
          ) : (
            <>
              <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`h-[70%] aspect-[3/4] rounded-[45%] border-4 border-dashed transition-colors ${quality?.ok ? 'border-accent-ok/80' : 'border-white/40'}`}
                />
              </div>
              <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4">
                <p className="font-semibold capitalize text-white">{angle} photo</p>
                <p className="text-sm text-white/80">{hint}</p>
              </div>
              {quality && (
                <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-black/70 to-transparent p-4">
                  {quality.ok ? (
                    <span className="rounded-full bg-accent-ok/25 px-3 py-1 text-xs font-semibold text-emerald-200">Good lighting & focus</span>
                  ) : (
                    quality.issues.map((i) => (
                      <span key={i} className="rounded-full bg-accent-warn/25 px-3 py-1 text-xs font-semibold text-amber-200">
                        {ISSUE_TEXT[i]}
                      </span>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4">
          <DepthButton variant="ghost" onClick={onClose}>Cancel</DepthButton>
          <DepthButton icon={<Icon name="camera" size={18} />} onClick={capture} disabled={Boolean(error)}>
            Capture
          </DepthButton>
        </div>
      </div>
    </div>
  );
}
