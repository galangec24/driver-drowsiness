/** Owner shown in the copyright notices (website, apps). */
export const COPYRIGHT_OWNER = 'Emmanuel Christian';
export const PRODUCT = 'Guardian Drive';
/** First year of the project; the notice shows "2026" or "2026–<this year>". */
export const FIRST_YEAR = 2026;

export function copyrightYears(now: Date = new Date()): string {
  const y = now.getFullYear();
  return y > FIRST_YEAR ? `${FIRST_YEAR}–${y}` : String(FIRST_YEAR);
}
