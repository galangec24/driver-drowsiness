import type { IconName } from '../ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Active only on this exact path (not its sub-pages). */
  end?: boolean;
}

/** Parents: their own drivers and alerts. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/drivers', label: 'Drivers', icon: 'drivers' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/** Admins get a different console: accounts across the system and model training. */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'dashboard', end: true },
  { to: '/admin/parents', label: 'Parents', icon: 'drivers' },
  { to: '/admin/training', label: 'Training', icon: 'lab' },
  { to: '/admin/models', label: 'Models', icon: 'shield' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function navItemsFor(role: string | undefined): NavItem[] {
  return role === 'admin' ? ADMIN_NAV_ITEMS : NAV_ITEMS;
}
