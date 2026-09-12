import type { AppConfig, LocationConfig, DayHours, WeekHours } from "./config.js";

export type Intent = "hours" | "book" | "emergency" | "human" | "other";
export type Consent = "pending" | "yes" | "no";
export type ScriptAction = "none" | "transfer" | "ticket" | "collect_booking";

export interface ScriptInput {
  locationId: string;
  now: Date;
  consent: Consent;
  intent?: Intent;
  angry?: boolean;
}

export interface ScriptResult {
  lines: string[];
  transcribe: boolean;
  action: ScriptAction;
  locationId: string;
}

const JS_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type WeekdayKey = (typeof JS_WEEKDAYS)[number];

/** Clinic week, Monday first — used to print hours. */
const CLINIC_WEEK: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const WEEKDAY_NOMINATIVE: Record<WeekdayKey, string> = {
  monday: "poniedziałek",
  tuesday: "wtorek",
  wednesday: "środa",
  thursday: "czwartek",
  friday: "piątek",
  saturday: "sobota",
  sunday: "niedziela",
};

const WEEKDAY_ACCUSATIVE: Record<WeekdayKey, string> = {
  monday: "poniedziałek",
  tuesday: "wtorek",
  wednesday: "środę",
  thursday: "czwartek",
  friday: "piątek",
  saturday: "sobotę",
  sunday: "niedzielę",
};

function zoned(now: Date, timeZone: string): { weekday: WeekdayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Monday";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const weekday = JS_WEEKDAYS.find(
    (key) => key === weekdayName.toLowerCase(),
  ) as WeekdayKey;
  return { weekday, minutes: hour * 60 + minute };
}

function parseHm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function sameHours(a: DayHours | null, b: DayHours | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.open === b.open && a.close === b.close;
}

/** Spoken hours from `location.hours` only — groups consecutive days with the same times. */
export function hoursSummary(hours: WeekHours): string {
  const groups: { start: WeekdayKey; end: WeekdayKey; spec: DayHours | null }[] =
    [];
  for (const day of CLINIC_WEEK) {
    const spec = hours[day];
    const last = groups[groups.length - 1];
    if (last && sameHours(last.spec, spec)) {
      last.end = day;
      continue;
    }
    groups.push({ start: day, end: day, spec });
  }
  return groups
    .map((group) => {
      const days =
        group.start === group.end
          ? WEEKDAY_NOMINATIVE[group.start]
          : `${WEEKDAY_NOMINATIVE[group.start]}–${WEEKDAY_NOMINATIVE[group.end]}`;
      if (!group.spec) {
        return `${days} nieczynne`;
      }
      return `${days} ${group.spec.open}–${group.spec.close}`;
    })
    .join(", ");
}

export function isOpenAt(
  hours: WeekHours,
  now: Date,
  timeZone: string,
): boolean {
  const { weekday, minutes } = zoned(now, timeZone);
  const day = hours[weekday];
  if (!day) {
    return false;
  }
  const open = parseHm(day.open);
  const close = parseHm(day.close);
  return minutes >= open && minutes < close;
}

export function nextOpenLabel(
  hours: WeekHours,
  now: Date,
  timeZone: string,
): string {
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const { weekday, minutes } = zoned(candidate, timeZone);
    const day = hours[weekday];
    if (!day) {
      continue;
    }
    const open = parseHm(day.open);
    const close = parseHm(day.close);
    if (offset === 0 && minutes >= close) {
      continue;
    }
    if (offset === 0 && minutes < open) {
      return `dziś o ${day.open}`;
    }
    if (offset === 1) {
      return `jutro o ${day.open}`;
    }
    return `w ${WEEKDAY_ACCUSATIVE[weekday]} o ${day.open}`;
  }
  return "w godzinach otwarcia";
}

export function noticeLine(location: LocationConfig): string {
  return `${location.name}. Rozmowa może być nagrywana na potrzeby jakości obsługi. Jeśli się Państwo nie zgadzają, proszę powiedzieć: nie zgadzam się.`;
}

function hoursLine(location: LocationConfig): string {
  return `${location.name}, ${location.address}. ${hoursSummary(location.hours)}. Telefon ${location.phone}.`;
}

function bookingLine(): string {
  return "Nie umawiam wizyty w kalendarzu od razu — recepcja potwierdzi SMS-em. Proszę o imię i nazwisko, numer telefonu, czy byli Państwo u nas, preferowany dzień oraz krótki powód wizyty. Nie obiecuję konkretnej godziny.";
}

export function reply(config: AppConfig, input: ScriptInput): ScriptResult {
  const location = config.locations.find((item) => item.id === input.locationId);
  if (!location) {
    throw new Error(`unknown location ${input.locationId}`);
  }

  const transcribe = input.consent !== "no";
  const open = isOpenAt(location.hours, input.now, config.timezone);
  const nextOpen = nextOpenLabel(location.hours, input.now, config.timezone);

  if (input.consent === "pending") {
    return {
      lines: [noticeLine(location)],
      transcribe: false,
      action: "none",
      locationId: location.id,
    };
  }

  const lines: string[] = [];
  if (input.consent === "no") {
    lines.push(
      "Rozumiem. Nie będę transkrybować tej rozmowy. Nadal mogę podać godziny albo przyjąć zgłoszenie wizyty.",
    );
  }

  const intent = input.angry ? "human" : input.intent;

  if (!intent || intent === "other") {
    lines.push(
      "W czym mogę pomóc? Umówić wizytę, godziny i dojazd, czy połączyć z recepcją?",
    );
    return {
      lines,
      transcribe,
      action: "none",
      locationId: location.id,
    };
  }

  if (intent === "hours") {
    lines.push(hoursLine(location));
    return { lines, transcribe, action: "none", locationId: location.id };
  }

  if (intent === "book") {
    lines.push(bookingLine());
    return {
      lines,
      transcribe,
      action: "collect_booking",
      locationId: location.id,
    };
  }

  if (intent === "emergency") {
    lines.push("Rozumiem, że to pilne. Nie stawiam diagnozy przez telefon.");
    if (open) {
      lines.push("Łączę z recepcją.");
      return { lines, transcribe, action: "transfer", locationId: location.id };
    }
    lines.push(
      `W silnym bólu, krwawieniu lub urazie proszę zgłosić się na SOR. Zostawiam zgłoszenie — recepcja oddzwoni, gdy otworzymy ${nextOpen}.`,
    );
    return { lines, transcribe, action: "ticket", locationId: location.id };
  }

  if (open) {
    lines.push("Łączę z recepcją.");
    return { lines, transcribe, action: "transfer", locationId: location.id };
  }
  lines.push(
    `Recepcja jest nieczynna. Zostawiam zgłoszenie. Proszę zadzwonić ${nextOpen} albo poczekać na oddzwonienie. Nie łączę teraz z człowiekiem.`,
  );
  return { lines, transcribe, action: "ticket", locationId: location.id };
}
