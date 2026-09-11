import type { AppConfig, LocationConfig, WeekHours } from "./config.js";

export type Lang = "pl" | "en";
export type Intent = "hours" | "book" | "emergency" | "human" | "other";
export type Consent = "pending" | "yes" | "no";
export type ScriptAction = "none" | "transfer" | "ticket" | "collect_booking";

export interface ScriptInput {
  lang: Lang;
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

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const WEEKDAY_PL: Record<WeekdayKey, string> = {
  monday: "poniedziałek",
  tuesday: "wtorek",
  wednesday: "środę",
  thursday: "czwartek",
  friday: "piątek",
  saturday: "sobotę",
  sunday: "niedzielę",
};

const WEEKDAY_EN: Record<WeekdayKey, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
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
  const weekday = WEEKDAY_KEYS.find(
    (key) => key === weekdayName.toLowerCase(),
  ) as WeekdayKey;
  return { weekday, minutes: hour * 60 + minute };
}

function parseHm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
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
  lang: Lang,
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
      return formatNext(lang, weekday, day.open, "today");
    }
    if (offset === 1) {
      return formatNext(lang, weekday, day.open, "tomorrow");
    }
    return formatNext(lang, weekday, day.open, "later");
  }
  return lang === "pl" ? "w godzinach otwarcia" : "during opening hours";
}

function formatNext(
  lang: Lang,
  weekday: WeekdayKey,
  time: string,
  when: "today" | "tomorrow" | "later",
): string {
  if (lang === "pl") {
    if (when === "today") {
      return `dziś o ${time}`;
    }
    if (when === "tomorrow") {
      return `jutro o ${time}`;
    }
    return `w ${WEEKDAY_PL[weekday]} o ${time}`;
  }
  if (when === "today") {
    return `today at ${time}`;
  }
  if (when === "tomorrow") {
    return `tomorrow at ${time}`;
  }
  return `on ${WEEKDAY_EN[weekday]} at ${time}`;
}

export function noticeLine(location: LocationConfig, lang: Lang): string {
  if (lang === "en") {
    return `${location.name}. This call may be recorded for quality. To refuse, say: I don't agree.`;
  }
  return `${location.name}. Rozmowa może być nagrywana na potrzeby jakości obsługi. Jeśli się Państwo nie zgadzają, proszę powiedzieć: nie zgadzam się.`;
}

function hoursLine(location: LocationConfig, lang: Lang): string {
  if (lang === "en") {
    return `${location.name}, ${location.address}. Monday–Friday 08:00–20:00, Saturday 10:00–15:00, Sunday closed. Phone ${location.phone}.`;
  }
  return `${location.name}, ${location.address}. Poniedziałek–piątek 8:00–20:00, sobota 10:00–15:00, niedziela nieczynne. Telefon ${location.phone}.`;
}

function bookingLine(lang: Lang): string {
  if (lang === "en") {
    return "I cannot put you in the calendar myself. Reception will confirm by SMS. Please give your full name, callback number, whether you have visited us before, a preferred day, and a short reason for the visit. I will not promise an exact clock time.";
  }
  return "Nie umawiam wizyty w kalendarzu od razu — recepcja potwierdzi SMS-em. Proszę o imię i nazwisko, numer telefonu, czy byli Państwo u nas, preferowany dzień oraz krótki powód wizyty. Nie obiecuję konkretnej godziny.";
}

export function reply(config: AppConfig, input: ScriptInput): ScriptResult {
  const location = config.locations.find((item) => item.id === input.locationId);
  if (!location) {
    throw new Error(`unknown location ${input.locationId}`);
  }

  const transcribe = input.consent !== "no";
  const open = isOpenAt(location.hours, input.now, config.timezone);
  const nextOpen = nextOpenLabel(
    location.hours,
    input.now,
    config.timezone,
    input.lang,
  );

  if (input.consent === "pending") {
    return {
      lines: [noticeLine(location, input.lang)],
      transcribe: false,
      action: "none",
      locationId: location.id,
    };
  }

  const lines: string[] = [];
  if (input.consent === "no") {
    lines.push(
      input.lang === "en"
        ? "Understood. I will not transcribe this call. I can still help with hours or a visit request."
        : "Rozumiem. Nie będę transkrybować tej rozmowy. Nadal mogę podać godziny albo przyjąć zgłoszenie wizyty.",
    );
  }

  const intent = input.angry ? "human" : input.intent;

  if (!intent || intent === "other") {
    lines.push(
      input.lang === "en"
        ? "How can I help? Book a visit, hours and directions, or speak to reception?"
        : "W czym mogę pomóc? Umówić wizytę, godziny i dojazd, czy połączyć z recepcją?",
    );
    return {
      lines,
      transcribe,
      action: "none",
      locationId: location.id,
    };
  }

  if (intent === "hours") {
    lines.push(hoursLine(location, input.lang));
    return { lines, transcribe, action: "none", locationId: location.id };
  }

  if (intent === "book") {
    lines.push(bookingLine(input.lang));
    return {
      lines,
      transcribe,
      action: "collect_booking",
      locationId: location.id,
    };
  }

  if (intent === "emergency") {
    if (input.lang === "en") {
      lines.push(
        "I understand this is urgent. I do not diagnose over the phone.",
      );
      if (open) {
        lines.push("I am transferring you to reception.");
        return { lines, transcribe, action: "transfer", locationId: location.id };
      }
      lines.push(
        `If you have severe pain, bleeding, or trauma, go to the emergency department (SOR). I will leave a ticket. Reception will call back when we open ${nextOpen}.`,
      );
      return { lines, transcribe, action: "ticket", locationId: location.id };
    }
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

  // human / angry
  if (open) {
    lines.push(input.lang === "en" ? "I am transferring you to reception." : "Łączę z recepcją.");
    return { lines, transcribe, action: "transfer", locationId: location.id };
  }
  lines.push(
    input.lang === "en"
      ? `Reception is closed. I will leave a ticket. Please call ${nextOpen}, or wait for a callback. I will not pretend someone is joining this call.`
      : `Recepcja jest nieczynna. Zostawiam zgłoszenie. Proszę zadzwonić ${nextOpen} albo poczekać na oddzwonienie. Nie łączę teraz z człowiekiem.`,
  );
  return { lines, transcribe, action: "ticket", locationId: location.id };
}
