import { COPYRIGHT_OWNER, PRODUCT, copyrightYears } from '../../lib/brand';

/** "© 2026 Guardian Drive · Emmanuel Christian. All rights reserved." (the year updates itself) */
export function Copyright({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-ink-muted ${className}`} data-testid="copyright">
      © {copyrightYears()} {PRODUCT} · {COPYRIGHT_OWNER}. All rights reserved.
    </p>
  );
}
