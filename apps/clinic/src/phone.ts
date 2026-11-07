/**
 * Normalise a Polish phone number to E.164 (+48XXXXXXXXX).
 * Returns null when the text is not a phone number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) {
    return digits.startsWith("+48") && digits.length !== 12 ? null : digits;
  }
  if (/^0048\d{9}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^48\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+48${digits}`;
  return null;
}
