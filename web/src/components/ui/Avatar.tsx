import { useState } from 'react';
import { assetUrl } from '../../api/client';
import { initials } from '../../lib/format';

export function Avatar({ name, url, size = 56 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = assetUrl(url);
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-accent-primary/50 to-ink-800 shadow-depth-2"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white/90">
          {initials(name)}
        </span>
      )}
    </div>
  );
}
