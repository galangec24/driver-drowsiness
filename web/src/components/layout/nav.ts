import type { IconName } from '../ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Only shown to accounts with the admin role. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/drivers', label: 'Drivers', icon: 'drivers' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/admin', label: 'Admin', icon: 'lab', adminOnly: true },
];

export function navItemsFor(role: string | undefined): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.adminOnly || role === 'admin');
}
