import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { FleetEntry } from '../../lib/fleet';
import { directionsUrl } from '../../lib/maps';
import { timeAgo } from '../../lib/format';
import { Icon } from '../ui/Icon';

const TEXT = {
  drowsy: { label: 'Drowsy', cls: 'border-accent-danger/50 bg-accent-danger/15 text-red-100', dot: 'bg-accent-danger' },
  warning: { label: 'Getting tired', cls: 'border-amber-400/50 bg-amber-400/10 text-amber-100', dot: 'bg-accent-warn' },
} as const;

/**
 * Several drivers can be in trouble at the same time (different cars): one row each, most urgent
 * first, so no alert hides another.
 */
export function AttentionPanel({ entries }: { entries: FleetEntry[] }) {
  if (!entries.length) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass border border-accent-danger/40 p-4"
      data-testid="attention-panel"
      role="alert"
    >
      <h2 className="flex items-center gap-2 text-lg font-bold text-white">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-danger" />
        {entries.length === 1 ? '1 driver needs attention' : `${entries.length} drivers need attention`}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {entries.map((e) => {
          const t = TEXT[e.status as 'drowsy' | 'warning'];
          return (
            <li key={e.driver.id} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${t.cls}`}>
              <span className={`h-2 w-2 rounded-full ${t.dot}`} />
              <Link to={`/drivers/${e.driver.id}`} className="font-semibold text-white hover:underline">
                {e.driver.name}
              </Link>
              <span className="text-sm">{t.label}</span>
              {e.lastUpdate && <span className="text-xs opacity-80">{timeAgo(e.lastUpdate)}</span>}
              <span className="ml-auto flex gap-2">
                {e.location && (
                  <a
                    href={directionsUrl(e.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-black/30 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/50"
                  >
                    <Icon name="directions" size={14} /> Directions
                  </a>
                )}
                <Link
                  to={`/drivers/${e.driver.id}`}
                  className="rounded-lg bg-black/30 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/50"
                >
                  Open
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
