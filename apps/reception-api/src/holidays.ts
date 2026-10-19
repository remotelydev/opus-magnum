function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function polishHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  if (year >= 2025) {
    fixed.push("12-24");
  }
  return [
    ...fixed.map((monthDay) => `${year}-${monthDay}`),
    iso(easter),
    iso(plusDays(easter, 1)),
    iso(plusDays(easter, 49)),
    iso(plusDays(easter, 60)),
  ].sort();
}

export function isClosedDate(date: string, closedDates: readonly string[] = []): boolean {
  return closedDates.includes(date) || polishHolidays(Number(date.slice(0, 4))).includes(date);
}
