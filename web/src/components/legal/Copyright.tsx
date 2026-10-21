import { Link } from 'react-router-dom';
import { COPYRIGHT_OWNER, PRODUCT, copyrightYears } from '../../lib/brand';

/**
 * "© 2026 Guardian Drive · Emmanuel Christian. All rights reserved." (the year updates itself).
 * The product opens About Guardian Drive and the name opens About the developer.
 */
export function Copyright({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-ink-muted ${className}`} data-testid="copyright">
      © {copyrightYears()}{' '}
      <Link to="/about" className="hover:text-white hover:underline">
        {PRODUCT}
      </Link>{' '}
      ·{' '}
      <Link to="/about-me" className="hover:text-white hover:underline" data-testid="developer-link">
        {COPYRIGHT_OWNER}
      </Link>
      . All rights reserved.
    </p>
  );
}
