import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { createDriver, findDuplicateName, listDrivers } from '../api/drivers';
import { errorMessage } from '../api/client';
import type { PhotoReport } from '../api/types';
import { GlassCard } from '../components/ui/GlassCard';
import { FloatingInput } from '../components/ui/FloatingInput';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { CameraCapture } from '../components/driver/CameraCapture';
import { useToast } from '../components/ui/Toast';
import { analyzeSource, ISSUE_TEXT, loadImage, toJpegDataUrl, type QualityReport } from '../lib/imageQuality';

const ANGLES = ['front', 'left', 'right'] as const;
type Angle = (typeof ANGLES)[number];

interface Shot {
  dataUrl: string;
  quality: QualityReport | null;
}

/** Mirrors the backend rules; `soft` skips the "required" error while the field is untouched. */
export function validateDriverName(name: string, existing: { name: string }[], soft = false): string {
  const trimmed = name.trim();
  if (!trimmed) return soft ? '' : 'Enter the driver’s name';
  if (trimmed.length < 2) return 'Name must be at least 2 characters';
  if (!/\p{L}/u.test(trimmed)) return 'Name must contain letters';
  const dup = findDuplicateName(trimmed, existing);
  if (dup) return `“${dup}” is already registered. Twins need distinct names (add a middle name or nickname).`;
  return '';
}

const RELATIONSHIPS = ['son', 'daughter', 'spouse', 'parent', 'sibling', 'employee', 'other'];

export function RegisterDriverPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('son');
  const [shots, setShots] = useState<Partial<Record<Angle, Shot>>>({});
  const [camera, setCamera] = useState<Angle | null>(null);
  const [nameError, setNameError] = useState('');
  const [serverReports, setServerReports] = useState<PhotoReport[] | null>(null);
  const fileInputs = useRef<Partial<Record<Angle, HTMLInputElement | null>>>({});
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers });

  const create = useMutation({
    mutationFn: createDriver,
    onSuccess: (res) => {
      setServerReports(res.photos);
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.show({
        title: `${res.driver.name} registered`,
        body: `Face enrolled from ${res.photos.length} photos · quality ${Math.round(res.quality * 100)}%`,
        tone: 'success',
      });
      for (const twin of res.similarFaces ?? []) {
        toast.show({
          title: `Looks very similar to ${twin.name}`,
          body: 'If they are twins, face verification may not tell them apart — alerts still use each driver\'s own device.',
          tone: 'warn',
          durationMs: 10000,
        });
      }
      navigate(`/drivers/${res.driverId}`);
    },
  });

  async function onFile(angle: Angle, file: File | undefined) {
    if (!file) return;
    try {
      const img = await loadImage(file);
      const dataUrl = toJpegDataUrl(img, img.naturalWidth, img.naturalHeight);
      setShots((s) => ({ ...s, [angle]: { dataUrl, quality: analyzeSource(img, img.naturalWidth, img.naturalHeight) } }));
    } catch (err) {
      toast.show({ title: 'Could not use that file', body: errorMessage(err), tone: 'danger' });
    }
  }

  const photos = ANGLES.map((a) => shots[a]?.dataUrl).filter((p): p is string => Boolean(p));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateDriverName(name, drivers.data ?? []);
    if (err) {
      setNameError(err);
      return;
    }
    setNameError('');
    create.mutate({ name: name.trim(), relationship, photos });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-white">
          <Icon name="back" size={16} /> Back
        </button>
        <h1 className="page-title">Register driver</h1>
        <p className="text-sm text-ink-muted">
          Three photos (front, left, right) let the server build an accurate face profile. Photos are processed on our server
          only.
        </p>
      </header>

      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <GlassCard interactive={false} className="flex flex-col gap-4 self-start">
          <FloatingInput
            label="Driver name"
            icon={<Icon name="user" size={18} />}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError('');
            }}
            onBlur={() => setNameError(validateDriverName(name, drivers.data ?? [], true))}
            error={nameError}
          />
          <p className="-mt-2 text-xs text-ink-muted">
            Each driver needs a unique name — for twins, add a middle name or nickname.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="label">Relationship</span>
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="h-12 rounded-xl border border-white/10 bg-black/25 px-3 capitalize text-white shadow-inner outline-none focus:border-accent-glow/70"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r} className="bg-ink-900 capitalize">
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="glass-inset p-3 text-xs text-ink-muted">
            <p className="font-semibold text-white">Tips</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Even, front-facing light — no strong backlight</li>
              <li>Only the driver in frame, face filling the oval</li>
              <li>Remove sunglasses</li>
            </ul>
          </div>
          {create.isError && (
            <p role="alert" className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-sm text-red-200">
              {errorMessage(create.error, 'Enrollment failed')}
            </p>
          )}
          <DepthButton type="submit" size="lg" block loading={create.isPending} disabled={photos.length === 0}>
            {create.isPending ? 'Enrolling face…' : `Register with ${photos.length}/3 photos`}
          </DepthButton>
        </GlassCard>

        <div className="grid gap-4 sm:grid-cols-3">
          {ANGLES.map((angle, i) => {
            const shot = shots[angle];
            const report = serverReports?.find((r) => r.index === photos.indexOf(shot?.dataUrl ?? ''));
            return (
              <GlassCard key={angle} interactive={false} padded={false} className="flex flex-col overflow-hidden">
                <div className="relative aspect-[3/4] bg-black/30">
                  <AnimatePresence mode="wait">
                    {shot ? (
                      <motion.img
                        key={shot.dataUrl.slice(-32)}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        src={shot.dataUrl}
                        alt={`${angle} photo`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
                        <Icon name="camera" size={36} />
                        <span className="text-sm">Step {i + 1}</span>
                      </div>
                    )}
                  </AnimatePresence>
                  <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
                    {angle}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="min-h-[1.5rem] text-xs">
                    {shot?.quality &&
                      (shot.quality.ok ? (
                        <span className="text-emerald-300">Good lighting & focus</span>
                      ) : (
                        <span className="text-amber-300">{shot.quality.issues.map((x) => ISSUE_TEXT[x]).join(' · ')}</span>
                      ))}
                    {report && <span className="block text-ink-muted">Server quality {Math.round(report.quality * 100)}%</span>}
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <DepthButton type="button" size="sm" variant="secondary" icon={<Icon name="camera" size={16} />} onClick={() => setCamera(angle)}>
                      Camera
                    </DepthButton>
                    <DepthButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<Icon name="upload" size={16} />}
                      onClick={() => fileInputs.current[angle]?.click()}
                    >
                      Upload
                    </DepthButton>
                    <input
                      ref={(el) => {
                        fileInputs.current[angle] = el;
                      }}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      aria-label={`Upload ${angle} photo`}
                      onChange={(e) => {
                        void onFile(angle, e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </form>

      {camera && (
        <CameraCapture
          angle={camera}
          onClose={() => setCamera(null)}
          onCapture={(dataUrl, quality) => {
            setShots((s) => ({ ...s, [camera]: { dataUrl, quality } }));
            const next = ANGLES[ANGLES.indexOf(camera) + 1];
            setCamera(next && !shots[next] ? next : null);
          }}
        />
      )}
    </div>
  );
}
