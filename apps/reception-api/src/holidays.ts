function easterSunday(year: number): Date {
  const goldenNumber = year % 19;
  const century = Math.floor(year / 100);
  const yearInCentury = year % 100;
  const skippedLeapCenturies = Math.floor(century / 4);
  const centuryLeapRemainder = century % 4;
  const moonOrbitCorrection = Math.floor((century + 8) / 25);
  const lunarCorrection = Math.floor((century - moonOrbitCorrection + 1) / 3);
  const daysToFullMoon =
    (19 * goldenNumber + century - skippedLeapCenturies - lunarCorrection + 15) % 30;
  const leapYearsInCentury = Math.floor(yearInCentury / 4);
  const yearLeapRemainder = yearInCentury % 4;
  const daysToSunday =
    (32 + 2 * centuryLeapRemainder + 2 * leapYearsInCentury - daysToFullMoon - yearLeapRemainder) % 7;
  const lateFullMoonShift = Math.floor((goldenNumber + 11 * daysToFullMoon + 22 * daysToSunday) / 451);
  const monthAndDay = daysToFullMoon + daysToSunday - 7 * lateFullMoonShift + 114;
  const month = Math.floor(monthAndDay / 31);
  const day = (monthAndDay % 31) + 1;
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
