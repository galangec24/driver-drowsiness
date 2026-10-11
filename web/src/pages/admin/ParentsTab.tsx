import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getParents, type ParentRow } from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { Icon } from '../../components/ui/Icon';
import { OrbitLoader } from '../../components/ui/OrbitLoader';
import { formatTime } from '../../lib/format';
import { Badge } from './shared';

const SIGN_IN: Record<ParentRow['signIn'], string> = {
  password: 'Password',
  google: 'Google',
  'google+password': 'Google + password',
};

function DriverChips({ p }: { p: ParentRow }) {
  if (!p.drivers.length) return <p className="text-sm text-ink-muted">No drivers registered yet.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {p.drivers.map((d) => (
        <li
          key={d.id}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white"
        >
          <span
            className={`h-2 w-2 rounded-full ${d.online ? 'bg-accent-ok shadow-[0_0_8px_#10b981]' : 'bg-white/25'}`}
            title={d.online ? 'Online' : 'Offline'}
          />
          {d.name}
          {d.relationship && <span className="text-xs text-ink-muted">· {d.relationship}</span>}
          {!d.faceEnrolled && <Badge tone="warn">no face</Badge>}
        </li>
      ))}
    </ul>
  );
}

/** Every account (parents and admins) with how many drivers each registered. */
export function ParentsTab() {
  const q = useQuery({ queryKey: ['admin', 'parents'], queryFn: getParents, refetchInterval: 15000 });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = q.data?.parents ?? [];
    return s
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            p.email.toLowerCase().includes(s) ||
            p.drivers.some((d) => d.name.toLowerCase().includes(s)),
        )
      : all;
  }, [q.data, search]);

  if (q.isLoading)
    return (
      <div className="flex justify-center py-16">
        <OrbitLoader size={72} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <GlassCard interactive={false} className="text-red-200">
        {errorMessage(q.error)}
      </GlassCard>
    );
  const t = q.data.totals;

  return (
    <div className="flex flex-col gap-6" data-testid="admin-parents">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(
          [
            ['Parents', t.parents],
            ['Drivers registered', t.drivers],
            ['Drivers online now', t.onlineDrivers],
            ['Unverified e-mails', t.unverified],
          ] as const
        ).map(([label, value]) => (
          <GlassCard key={label} interactive={false}>
            <p className="label">{label}</p>
            <p className="mt-1 text-2xl font-extrabold text-white">{value}</p>
          </GlassCard>
        ))}
      </div>

      <label className="glass-inset flex h-12 items-center gap-3 px-4">
        <Icon name="user" size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parent, e-mail or driver"
          aria-label="Search parents"
          className="h-full flex-1 bg-transparent text-sm text-white outline-none placeholder:text-ink-muted"
        />
        <span className="text-xs text-ink-muted">
          {rows.length} of {q.data.parents.length}
        </span>
      </label>

      {/* Phones: one card per parent. */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((p) => (
          <GlassCard key={p.id} interactive={false} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{p.name}</p>
                <p className="truncate text-sm text-ink-muted">{p.email}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold text-white">{p.driverCount}</p>
                <p className="text-xs text-ink-muted">{p.driverCount === 1 ? 'driver' : 'drivers'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {p.role === 'admin' && <Badge tone="info">admin</Badge>}
              <Badge>{SIGN_IN[p.signIn]}</Badge>
              {!p.emailVerified && <Badge tone="warn">unverified</Badge>}
              {p.onlineDrivers > 0 && <Badge tone="ok">{p.onlineDrivers} online</Badge>}
              <Badge>{p.alerts7d} alerts · 7 days</Badge>
            </div>
            <DriverChips p={p} />
            <p className="text-xs text-ink-muted">Joined {formatTime(p.createdAt)}</p>
          </GlassCard>
        ))}
      </div>

      {/* Tablets and up: a table; click a row for the driver list. */}
      <GlassCard interactive={false} className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Parent</th>
              <th className="px-4 py-3 font-semibold">Sign-in</th>
              <th className="px-4 py-3 text-center font-semibold">Drivers</th>
              <th className="px-4 py-3 text-center font-semibold">Online</th>
              <th className="px-4 py-3 text-center font-semibold">Alerts 7d / total</th>
              <th className="px-4 py-3 font-semibold">Last alert</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Fragment key={p.id}>
                <tr
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  aria-expanded={open === p.id}
                  className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{p.name}</span>
                      {p.role === 'admin' && <Badge tone="info">admin</Badge>}
                      {!p.emailVerified && <Badge tone="warn">unverified</Badge>}
                    </div>
                    <p className="text-xs text-ink-muted">{p.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{SIGN_IN[p.signIn]}</td>
                  <td className="px-4 py-3 text-center text-lg font-bold text-white">{p.driverCount}</td>
                  <td className="px-4 py-3 text-center">
                    {p.onlineDrivers > 0 ? (
                      <Badge tone="ok">{p.onlineDrivers}</Badge>
                    ) : (
                      <span className="text-ink-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-white">
                    {p.alerts7d} <span className="text-ink-muted">/ {p.alertsTotal}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{p.lastAlertAt ? formatTime(p.lastAlertAt) : '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatTime(p.createdAt)}</td>
                </tr>
                {open === p.id && (
                  <tr className="border-b border-white/5 bg-black/20">
                    <td colSpan={7} className="px-4 py-3">
                      <DriverChips p={p} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-ink-muted">No matching accounts.</p>}
      </GlassCard>
    </div>
  );
}
