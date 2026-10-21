/**
 * Languages a message can be written in, and the user's preferred language (same codes as the
 * server and the in-car voice). "auto" = the car works it out from the text.
 */
export const LANGUAGES = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'fil', label: 'Filipino (Tagalog)' },
  { code: 'ceb', label: 'Bisaya (Cebuano)' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'zh', label: '中文 (Chinese)' },
  { code: 'ja', label: '日本語 (Japanese)' },
  { code: 'ko', label: '한국어 (Korean)' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export function languageLabel(code: string | undefined): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? 'Auto-detect';
}
