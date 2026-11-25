/** Versum's surface code ("16kor", "26P1") in words; unknown codes are shown as they are. */
export function surfaceLabel(tooth: number, surface: string | null): string | null {
  if (!surface) return null;
  const rest = surface.startsWith(String(tooth)) ? surface.slice(String(tooth).length) : surface;
  if (rest === "kor") return "korona";
  const m = rest.match(/^P(\d)$/);
  return m ? `pow. ${m[1]}` : rest || null;
}
