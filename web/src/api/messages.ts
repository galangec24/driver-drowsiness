import { api } from './client';

export interface DriverMessage {
  id: string;
  driverId: string;
  fromName: string;
  text: string;
  kind: 'message' | 'reminder';
  status: 'pending' | 'delivered' | 'expired';
  deliveredAt: string | null;
  createdAt: string;
}

/** Ready-made reminders the in-car voice reads to the driver. */
export const QUICK_REMINDERS = [
  'Please take a break at the next safe stop.',
  'Drink some water and stay alert.',
  'Please slow down and drive safely.',
  'Call me when you arrive.',
  'Drive safely. We love you.',
];

export async function listMessages(driverId: string): Promise<DriverMessage[]> {
  const { data } = await api.get<{ messages: DriverMessage[] }>(`/drivers/${driverId}/messages`);
  return data.messages;
}

export async function sendMessage(
  driverId: string,
  body: { text: string; kind: 'message' | 'reminder' },
): Promise<{ message: DriverMessage; carOnline: boolean }> {
  const { data } = await api.post<{ message: DriverMessage; carOnline: boolean }>(
    `/drivers/${driverId}/messages`,
    body,
  );
  return data;
}
