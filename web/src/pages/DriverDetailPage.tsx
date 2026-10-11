import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteDriver, driverLogs, getDriver, updateThresholds, verifyDriver } from '../api/drivers';
import { listAlerts } from '../api/alerts';
import { errorMessage } from '../api/client';
import type { SensorLogPoint } from '../api/types';
import { usePollingFallback, useRealtime } from '../hooks/useRealtime';
import { GlassCard } from '../components/ui/GlassCard';
import { DepthButton } from '../components/ui/DepthButton';
import { Avatar } from '../components/ui/Avatar';
import { StatusPill } from '../components/ui/StatusPill';
import { LineChart } from '../components/ui/LineChart';
import { Icon } from '../components/ui/Icon';
import { OrbitLoader } from '../components/ui/OrbitLoader';
import { useToast } from '../components/ui/Toast';
import { ThresholdEditor } from '../components/driver/ThresholdEditor';
import { CameraCapture } from '../components/driver/CameraCapture';
import { AlertFeed } from '../components/alert/AlertFeed';
import { LocationMap } from '../components/map/LocationMap';
import { formatTime, timeAgo } from '../lib/format';
import { loadImage, toJpegDataUrl } from '../lib/imageQuality';

export function DriverDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { live, socket, connected } = useRealtime();
  const refetchInterval = usePollingFallback();
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const driver = useQuery({ queryKey: ['driver', id], queryFn: () => getDriver(id), refetchInterval });
  const logs = useQuery({
    queryKey: ['driverLogs', id],
    queryFn: () => driverLogs(id, 120),
    refetchInterval: connected ? false : 10000,
  });
  const alerts = useQuery({
    queryKey: ['alerts', { driverId: id, limit: 10 }],
    queryFn: () => listAlerts({ driverId: id, limit: 10 }),
    refetchInterval,
  });

  // Join the driver room and append live points to the chart series.
  useEffect(() => {
    if (socket && connected) socket.emit('subscribe:driver', { driverId: id });
  }, [socket, connected, id]);

  const current = live[id];
  useEffect(() => {
    if (!current) return;
    qc.setQueryData<SensorLogPoint[]>(['driverLogs', id], (old) => {
      if (!old) return old;
      if (old.length && old[old.length - 1]!.createdAt === current.lastUpdate) return old;
      return [
        ...old,
        {
          signals: current.signals ?? {},
          classification: current.status,
          fusionScore: current.fusionScore ?? 0,
          source: current.source ?? 'unknown',
          createdAt: current.lastUpdate,
        },
      ].slice(-120);
    });
  }, [current, id, qc]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateThresholds>[1]) => updateThresholds(id, patch),
    onSuccess: (d) => {
      qc.setQueryData(['driver', id], d);
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.show({ title: 'Thresholds saved', body: 'Applied to the next sensor reading.', tone: 'success' });
    },
    onError: (err) => toast.show({ title: 'Could not save', body: errorMessage(err), tone: 'danger' }),
  });

  const verify = useMutation({
    mutationFn: (photo: string) => verifyDriver(id, photo),
    onSuccess: (r) =>
      toast.show({
        title: r.match ? 'Face matches this driver' : 'Face does not match',
        body: `Confidence ${Math.round(r.confidence * 100)}%`,
        tone: r.match ? 'success' : 'warn',
      }),
    onError: (err) => toast.show({ title: 'Verification failed', body: errorMessage(err), tone: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: () => deleteDriver(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.show({ title: 'Driver removed', tone: 'info' });
      navigate('/drivers', { replace: true });
    },
    onError: (err) => toast.show({ title: 'Could not remove', body: errorMessage(err), tone: 'danger' }),
  });

  if (driver.isLoading)
    return (
      <div className="flex justify-center py-24">
        <OrbitLoader size={72} />
      </div>
    );
  if (driver.isError || !driver.data) {
    return (
      <GlassCard interactive={false} className="text-red-200">
        {errorMessage(driver.error, 'Driver not found')}
      </GlassCard>
    );
  }

  const d = driver.data;
  const points = logs.data ?? [];
  const status = current?.status ?? d.status;
  const lastUpdate = current?.lastUpdate ?? d.lastUpdate;
  const offline = !lastUpdate || Date.now() - new Date(lastUpdate).getTime() > 30000;

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1 text-sm text-ink-muted hover:text-white"
      >
        <Icon name="back" size={16} /> Back
      </button>

      <GlassCard
        interactive={false}
        danger={!offline && status === 'drowsy'}
        className="flex flex-wrap items-center gap-5"
      >
        <Avatar name={d.name} url={d.referencePhotoUrl} size={84} />
        <div className="min-w-0 flex-1">
          <h1 className="page-title truncate">{d.name}</h1>
          <p className="text-ink-muted">
            <span className="capitalize">{d.relationship || 'Driver'}</span> ·{' '}
            {d.faceEnrolled ? `face enrolled (${d.enrollment?.photoCount ?? 0} photos)` : 'no face enrolled'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Last update {timeAgo(lastUpdate)}
            {d.lastTunedAt && ` · thresholds auto-tuned ${formatTime(d.lastTunedAt)}`}
          </p>
        </div>
        <StatusPill status={offline ? 'offline' : status} />
      </GlassCard>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <GlassCard interactive={false} className="flex flex-col gap-6">
            <LineChart
              label="Eye aspect ratio (EAR)"
              values={points.map((p) => p.signals.ear ?? NaN)}
              threshold={d.personalThresholds.earThreshold}
              min={0}
              max={0.4}
              color="#818cf8"
            />
            <div className="grid gap-6 md:grid-cols-2">
              <LineChart
                label="Heart rate"
                values={points.map((p) => (p.signals.heartRate ? p.signals.heartRate : NaN))}
                unit=" bpm"
                color="#f472b6"
                height={100}
              />
              <LineChart
                label="Drowsiness score"
                values={points.map((p) => p.fusionScore)}
                threshold={0.7}
                min={0}
                max={1}
                color="#f59e0b"
                height={100}
              />
            </div>
            <p className="text-xs text-ink-muted">
              Dashed red line on EAR = this driver's personal threshold. Last {points.length} readings.
            </p>
          </GlassCard>

          <section>
            <h2 className="mb-3 text-lg font-bold text-white">Recent alerts</h2>
            <AlertFeed alerts={alerts.data?.alerts ?? []} emptyText="No alerts for this driver yet." />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <GlassCard interactive={false} data-testid="live-location">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
              <Icon name="pin" size={20} className="text-accent-glow" /> Live location
            </h2>
            <LocationMap location={current?.location ?? d.lastLocation} mode="live" />
          </GlassCard>

          <GlassCard interactive={false}>
            <h2 className="mb-4 text-lg font-bold text-white">Personal thresholds</h2>
            <ThresholdEditor value={d.personalThresholds} saving={save.isPending} onSave={(p) => save.mutate(p)} />
          </GlassCard>

          <GlassCard interactive={false} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-white">Verify face</h2>
            <p className="text-sm text-ink-muted">
              Check a new photo against this driver's enrolled face (matched on our server).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <DepthButton
                variant="secondary"
                size="sm"
                icon={<Icon name="camera" size={16} />}
                onClick={() => setCameraOpen(true)}
                disabled={!d.faceEnrolled}
                loading={verify.isPending}
              >
                Camera
              </DepthButton>
              <DepthButton
                variant="secondary"
                size="sm"
                icon={<Icon name="upload" size={16} />}
                onClick={() => fileRef.current?.click()}
                disabled={!d.faceEnrolled || verify.isPending}
              >
                Upload
              </DepthButton>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              aria-label="Upload verification photo"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const img = await loadImage(file);
                verify.mutate(toJpegDataUrl(img, img.naturalWidth, img.naturalHeight));
              }}
            />
          </GlassCard>

          <GlassCard interactive={false} className="flex items-center justify-between gap-3 border-accent-danger/30">
            <div>
              <p className="font-semibold text-white">Remove driver</p>
              <p className="text-xs text-ink-muted">Deletes the face profile and reference photo.</p>
            </div>
            <DepthButton
              variant="danger"
              size="sm"
              icon={<Icon name="trash" size={16} />}
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${d.name}? This cannot be undone.`)) remove.mutate();
              }}
            >
              Remove
            </DepthButton>
          </GlassCard>
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          angle="front"
          onClose={() => setCameraOpen(false)}
          onCapture={(dataUrl) => {
            setCameraOpen(false);
            verify.mutate(dataUrl);
          }}
        />
      )}
    </div>
  );
}
