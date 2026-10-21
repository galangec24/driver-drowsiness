import { useState } from 'react';
import { assetUrl } from '../../api/client';
import { initials } from '../../lib/format';

/** The signed-in user's round photo, or their initials when there is none. */
export function UserAvatar({
  name,
  url,
  size = 44,
  className = '',
}: {
  name?: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = assetUrl(url);
  const showPhoto = src && failed !== src;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent-primary to-accent-glow font-bold text-onaccent ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {showPhoto ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(src)} />
      ) : (
        initials(name || '?')
      )}
    </span>
  );
}
