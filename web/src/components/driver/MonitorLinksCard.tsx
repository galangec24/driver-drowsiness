/**
 * TESTING PHASE, admin console only: personal monitor links for a family's driver. Whoever opens
 * the link (the test driver, on their own phone) runs the driver monitor in the browser for this
 * driver only; the readings and alerts go to that family's account. Parents never see this. Shown once on creation;
 * revocable; expires. Remove with the web monitor (DRIVER_MONITOR_WEB).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { createMonitorLink, listMonitorLinks, monitorUrl, revokeMonitorLink } from '../../api/monitor';
import { errorMessage } from '../../api/client';
import { formatTime, timeAgo } from '../../lib/format';
import { GlassCard } from '../ui/GlassCard';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

export function MonitorLinksCard({
  driverId,
  driverName,
  familyName,
}: {
  driverId: string;
  driverName: string;
  familyName?: string;
}) {
  const qc = useQueryClient();
  const key = ['monitor-links', driverId];
  const links = useQuery({ queryKey: key, queryFn: () => listMonitorLinks(driverId), retry: false });
  const [fresh, setFresh] = useState<{ url: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => createMonitorLink(driverId, 7),
    onSuccess: async ({ token }) => {
      const url = monitorUrl(token);
      const qr = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0d1f', light: '#ffffff' } });
      setFresh({ url, qr });
      setCopied(false);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeMonitorLink,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  useEffect(() => setFresh(null), [driverId]);

  // The web monitor is turned off on the server: hide the card.
  if (links.isError && /turned off/i.test(errorMessage(links.error))) return null;

  const active = (links.data ?? []).filter((l) => l.status === 'active');
  return (
    <GlassCard interactive={false} data-testid="monitor-links">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="eye" size={18} className="text-accent-glow" />
        <h2 className="font-bold text-white">Phone monitor (testing)</h2>
      </div>
      <p className="text-sm text-ink-muted">
        A personal link that turns {driverName}’s phone into the driver monitor, no account needed. It can only send{' '}
        {driverName}’s readings{familyName ? ` (alerts go to ${familyName})` : ''} and works for 7 days, or until you
        revoke it.
      </p>

      {fresh && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-white/5 p-3" data-testid="monitor-link-new">
          <div
            className="h-40 w-40 overflow-hidden rounded-lg bg-white p-1"
            aria-label="QR code of the monitor link"
            // SVG generated locally by the qrcode library (as on the download page).
            dangerouslySetInnerHTML={{ __html: fresh.qr }}
          />
          <p className="break-all text-center font-mono text-xs text-white">{fresh.url}</p>
          <p className="text-center text-xs text-amber-200">
            Copy it now: for safety it is shown only once. Send it only to {driverName}.
          </p>
          <DepthButton
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(fresh.url).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </DepthButton>
        </div>
      )}

      {create.isError && <p className="mt-2 text-sm text-amber-300">{errorMessage(create.error)}</p>}

      {active.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-xs">
          {active.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <span className="min-w-0 flex-1 text-ink-muted">
                Created {timeAgo(l.createdAt)} · expires {formatTime(l.expiresAt)}
                {l.lastUsedAt ? ` · used ${timeAgo(l.lastUsedAt)}` : ' · not used yet'}
              </span>
              <button
                type="button"
                className="font-semibold text-red-300 hover:underline disabled:opacity-50"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(l.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <DepthButton icon={<Icon name="plus" size={16} />} loading={create.isPending} onClick={() => create.mutate()}>
          Create monitor link
        </DepthButton>
      </div>
    </GlassCard>
  );
}
