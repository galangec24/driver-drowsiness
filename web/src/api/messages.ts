import { api } from './client';

export interface DriverMessage {
  id: string;
  driverId: string;
  fromName: string;
  text: string;
  kind: 'message' | 'reminder';
  lang?: string;
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

/** The same reminders in the languages families use most; the car reads each in its own voice. */
export const REMINDER_LANGUAGES: { code: string; label: string; reminders: string[] }[] = [
  { code: 'en', label: 'English', reminders: QUICK_REMINDERS },
  {
    code: 'fil',
    label: 'Tagalog',
    reminders: [
      'Magpahinga ka muna sa susunod na ligtas na hintuan.',
      'Uminom ka ng tubig at manatiling alerto.',
      'Dahan-dahan lang sa pagmamaneho, ingat ka.',
      'Tawagan mo ako pagdating mo.',
      'Ingat sa pagmamaneho. Mahal ka namin.',
    ],
  },
  {
    code: 'ceb',
    label: 'Bisaya',
    reminders: [
      'Pahulay sa usa ka luwas nga hunonganan.',
      'Pag-inom ug tubig ug magpabilin nga alerto.',
      'Hinay-hinay lang sa pagdrayb, amping.',
      'Tawgi ko inig abot nimo.',
      'Amping sa pagdrayb. Gihigugma ka namo.',
    ],
  },
  {
    code: 'zh',
    label: '中文',
    reminders: [
      '请在下一个安全的地方停车休息。',
      '喝点水，保持清醒。',
      '请慢点开，注意安全。',
      '到了给我打电话。',
      '开车注意安全，我们爱你。',
    ],
  },
];

export async function listMessages(driverId: string): Promise<DriverMessage[]> {
  const { data } = await api.get<{ messages: DriverMessage[] }>(`/drivers/${driverId}/messages`);
  return data.messages;
}

export async function sendMessage(
  driverId: string,
  body: { text: string; kind: 'message' | 'reminder'; lang?: string },
): Promise<{ message: DriverMessage; carOnline: boolean }> {
  const { data } = await api.post<{ message: DriverMessage; carOnline: boolean }>(
    `/drivers/${driverId}/messages`,
    body,
  );
  return data;
}
