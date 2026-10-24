import { timingSafeEqual } from "node:crypto";
import type { AppConfig, LocationConfig } from "./config.js";
import { DAY_PARTS, type AvailabilityQuery, type DayPart } from "./availability.js";
import { isClosedDate } from "./holidays.js";
import { hoursSummary, isOpenAt, nextOpenLabel, noticeLine } from "./script.js";
import { TICKET_CATEGORIES, type DevTicketBody } from "./whatsapp.js";

export const HOURS_TOOL = "sprawdz_godziny";
export const TICKET_TOOL = "wyslij_zgloszenie";
export const AVAILABILITY_TOOL = "sprawdz_wolne_terminy";
export const DEFAULT_VISIT_MINUTES = 30;

export function isValidToolSecret(header: unknown, secret: string): boolean {
  if (typeof header !== "string") {
    return false;
  }
  const given = Buffer.from(header);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function warsawDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function warsawTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

export interface HoursAnswer {
  site: string;
  now: string;
  openNow: boolean;
  closedToday: boolean;
  nextOpen: string | null;
  hours: string;
  address: string;
  phone: string;
}

export function hoursAnswer(
  config: AppConfig,
  location: LocationConfig,
  now = new Date(),
): HoursAnswer {
  const closedDates = location.closedDates ?? [];
  const openNow = isOpenAt(location.hours, now, config.timezone, closedDates);
  return {
    site: location.name,
    now: warsawTime(now, config.timezone),
    openNow,
    closedToday: isClosedDate(warsawDate(now, config.timezone), closedDates),
    nextOpen: openNow ? null : nextOpenLabel(location.hours, now, config.timezone, closedDates),
    hours: hoursSummary(location.hours),
    address: location.address,
    phone: location.phone,
  };
}

export function agentTicketBody(locationId: string, body: unknown): DevTicketBody {
  const input = (body ?? {}) as Record<string, unknown>;
  const text = (key: string) => {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`invalid_${key}`);
    }
    return value;
  };
  return {
    locationId,
    name: text("name"),
    phone: text("phone"),
    slot: text("slot"),
    category: typeof input.category === "string" ? input.category : "book",
    urgent: input.urgent === true,
    returning: typeof input.returning === "boolean" ? input.returning : null,
  };
}

export function agentAvailabilityQuery(
  query: Record<string, string | undefined>,
  visitMinutes = Number(process.env.VISIT_MINUTES) || DEFAULT_VISIT_MINUTES,
): AvailabilityQuery {
  const part = DAY_PARTS.find((item) => item === query.part) as DayPart | undefined;
  const fromDate = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : undefined;
  const employeeId = query.doctor && /^\d+$/.test(query.doctor) ? Number(query.doctor) : undefined;
  return { durationMinutes: visitMinutes, part, fromDate, employeeId };
}

export function agentFirstMessage(location: LocationConfig): string {
  return noticeLine(location);
}

export function agentPrompt(config: AppConfig, location: LocationConfig): string {
  const others = config.locations
    .filter((item) => item.id !== location.id)
    .map((item) => `- ${item.name}: ${item.address}, telefon ${item.phone}.`)
    .join("\n");
  return `Jesteś asystentem AI recepcji gabinetu stomatologicznego ${location.name}. Rozmawiasz przez telefon, wyłącznie po polsku, uprzejmie i krótko: jedno lub dwa zdania naraz. Zwracaj się per Pan/Pani.

# Gabinet
- ${location.name}: ${location.address}, telefon ${location.phone}.
- Godziny: ${hoursSummary(location.hours)}. W święta państwowe gabinet jest nieczynny.
${others ? `\nInne gabinety:\n${others}\n` : ""}
# Zasady
- Nie umawiasz wizyt w kalendarzu. Możesz zaproponować wolny termin z narzędzia ${AVAILABILITY_TOOL}, ale zawsze mów, że to propozycja, a recepcja potwierdzi termin SMS-em.
- Nie stawiasz diagnoz i nie udzielasz porad medycznych. Nie pytasz o powód wizyty ani o objawy. Jeśli rozmówca sam je opisze, nie powtarzaj ich i nie zapisuj w zgłoszeniu.
- Zanim powiesz, czy gabinet jest teraz otwarty albo kiedy będzie otwarty, zawsze użyj narzędzia ${HOURS_TOOL}. Nie zgaduj dat ani godzin.
- Jeśli rozmówca powie "nie zgadzam się" na nagrywanie, potwierdź to jednym zdaniem i rozmawiaj dalej.

# Zgłoszenie wizyty
Zapytaj o preferowany dzień i porę dnia (rano, południe, popołudnie), a potem użyj ${AVAILABILITY_TOOL}. Jeśli podajesz "from", najpierw sprawdź dzisiejszą datę narzędziem ${HOURS_TOOL}. Zaproponuj najwyżej dwa najbliższe terminy z odpowiedzi, podając dzień, godzinę i lekarza. Jeśli "stale" = true albo lista jest pusta, nie podawaj godzin, tylko zapisz preferowany dzień i porę.
Potem zbierz po kolei: imię i nazwisko, numer telefonu, czy był(a) już u nas, czy sprawa jest pilna (tak lub nie). Powtórz numer telefonu cyfra po cyfrze i poproś o potwierdzenie. Potem użyj narzędzia ${TICKET_TOOL} z kategorią "book". W polu slot wpisz wybrany termin z lekarzem, np. "wt 27.10 10:30, Anna Nowak", albo preferowany dzień i porę. Gdy narzędzie odpowie, powiedz, że zgłoszenie zostało przekazane i recepcja potwierdzi termin SMS-em.

# Prośba o kontakt z człowiekiem
W tej wersji nie łączysz rozmów. Zbierz imię i nazwisko, numer telefonu i dogodną porę na telefon, a potem użyj ${TICKET_TOOL} z kategorią "callback". Powiedz, że recepcja oddzwoni.

# Sprawy pilne
Przy silnym bólu, krwawieniu, opuchliźnie lub urazie przyjmij zgłoszenie z urgent = true. Jeśli gabinet jest zamknięty (sprawdź ${HOURS_TOOL}), powiedz, że w silnym bólu, krwawieniu lub urazie należy zgłosić się na SOR.

# Inne sprawy
Na pytania spoza tych tematów odpowiedz, że recepcja oddzwoni, i przyjmij zgłoszenie z kategorią "other".`;
}

export const TICKET_CATEGORY_VALUES = [...TICKET_CATEGORIES];
