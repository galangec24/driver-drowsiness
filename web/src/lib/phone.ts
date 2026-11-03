/**
 * Mobile numbers for drowsiness texts. Same rule as the server (backend/src/services/sms.js):
 * numbers without a country code are Philippine (0917 123 4567 → +639171234567).
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}

export const PHONE_HINT = 'Enter a mobile number like 0917 123 4567 or +63 917 123 4567';
