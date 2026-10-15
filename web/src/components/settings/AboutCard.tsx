import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../../api/client';
import { COPYRIGHT_OWNER, PRODUCT, copyrightYears } from '../../lib/brand';
import { formatTime, timeAgo } from '../../lib/format';
import { GlassCard } from '../ui/GlassCard';

const RELEASES_API = 'https://api.github.com/repos/galangec24/guardian-drive-download/releases/latest';

interface Health {
  version?: string;
  commit?: string | null;
  startedAt?: string;
}
interface Release {
  tag_name: string;
  published_at: string;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2.5 text-sm last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right text-white">{children}</span>
    </div>
  );
}

/**
 * About: everything here is read live (no hand-edited numbers): this site's version and build,
 * the server's version, and the newest published app release.
 */
export function AboutCard({ footer }: { footer?: ReactNode }) {
  const health = useQuery({
    queryKey: ['about', 'health'],
    queryFn: async (): Promise<Health> => (await fetch(`${API_URL}/api/health`, { cache: 'no-store' })).json(),
    staleTime: 60_000,
  });
  const release = useQuery({
    queryKey: ['about', 'release'],
    queryFn: async (): Promise<Release> => {
      const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  const latest = release.data?.tag_name?.replace(/^v/, '');

  return (
    <GlassCard interactive={false} data-testid="about-card">
      <h2 className="mb-2 text-lg font-bold text-white">About</h2>
      <Row label="Version">{__APP_VERSION__}</Row>
      <Row label="Website updated">
        <span title={formatTime(__BUILD_TIME__)}>{timeAgo(__BUILD_TIME__)}</span>
        {__GIT_COMMIT__ && <span className="ml-1 font-mono text-xs text-ink-muted">({__GIT_COMMIT__})</span>}
      </Row>
      <Row label="Server">
        {health.isLoading ? (
          '…'
        ) : health.data ? (
          <span className="text-emerald-300">
            Online · v{health.data.version}
            {health.data.commit && (
              <span className="ml-1 font-mono text-xs text-ink-muted">({health.data.commit})</span>
            )}
          </span>
        ) : (
          <span className="text-amber-300">Not reachable</span>
        )}
      </Row>
      <Row label="Latest app release">
        {latest ? (
          <>
            {latest}
            <span className="ml-1 text-xs text-ink-muted">· {timeAgo(release.data!.published_at)}</span>
          </>
        ) : release.isLoading ? (
          '…'
        ) : (
          '—'
        )}
      </Row>
      <Row label="Server address">
        <span className="break-all font-mono text-xs">{API_URL}</span>
      </Row>
      {footer}
      <p className="mt-4 text-xs text-ink-muted" data-testid="about-copyright">
        © {copyrightYears()} {PRODUCT} · {COPYRIGHT_OWNER}. All rights reserved. Maps © OpenStreetMap contributors,
        OpenFreeMap. Face detection: Google MediaPipe, face-api.js.
      </p>
    </GlassCard>
  );
}
