import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useOutlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SideRail } from './SideRail';
import { BottomNav } from './BottomNav';
import { InstallBanner, OfflineBanner } from './Banners';
import { listAlerts } from '../../api/alerts';
import { usePollingFallback } from '../../hooks/useRealtime';
import { Copyright } from '../legal/Copyright';
import { NotificationBell } from '../notifications/NotificationBell';
import { AccountMenu } from './AccountMenu';
import { MenuDrawer } from './MenuDrawer';
import { AnimatedBackground } from './AnimatedBackground';
import { useNavCollapsed } from '../../lib/navState';

/**
 * Responsive shell: side rail ≥640 px (labels ≥1024 px), bottom nav < 640 px,
 * content max-width 1280 px, animated mesh background, 200 ms page transitions.
 */
export function AppShell() {
  const location = useLocation();
  const outlet = useOutlet();
  const refetchInterval = usePollingFallback();
  const { data } = useQuery({
    queryKey: ['alerts', { status: 'open', limit: 50 }],
    queryFn: () => listAlerts({ status: 'open', limit: 50 }),
    refetchInterval,
  });
  const unacknowledged = data?.unacknowledged ?? 0;
  const [collapsed] = useNavCollapsed();

  return (
    <div data-testid="app-shell" className="relative min-h-screen min-h-dvh">
      <AnimatedBackground />
      <SideRail unacknowledged={unacknowledged} />
      <MenuDrawer />
      <AccountMenu />
      <NotificationBell />
      <main
        className={`pb-28 pt-[4.5rem] transition-[padding] duration-200 sm:pb-10 sm:pl-28 sm:pt-5 ${collapsed ? '' : 'lg:pl-[17rem]'}`}
      >
        <div className="mx-auto w-full max-w-content px-4 sm:px-6">
          <OfflineBanner />
          <InstallBanner />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
          <Copyright className="mt-10" />
        </div>
      </main>
      <BottomNav unacknowledged={unacknowledged} />
    </div>
  );
}
