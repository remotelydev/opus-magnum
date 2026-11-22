// Patient registration form shown on the clinic iPads ("Formularz rejestracyjny").
//
// One definition drives everything: the iPad renders it, the API validates answers against it, and
// reception turns accepted answers into a patient card with `toPatient`. The questions below are
// SAMPLES until the clinic supplies the real ones; changing them means editing FORM only.
//
// Imported by the API (src/) and the web UI (web/src/kiosk), so it must stay free of Node-only code.
import { normalizePhone } from "./phone.js";

export type Answer = string | string[] | boolean;
export type Answers = Record<string, Answer>;

/** Fields copied straight into the patient card when reception accepts a registration. */
export type PatientKey = "firstName" | "lastName" | "phone" | "email" | "birthDate" | "smsConsent";

export interface Option {
  value: string;
  label: string;
  /** Added to the card's medical flags when chosen. */
  flag?: string;
  /** "None of the above": cannot be ticked together with other options. */
  exclusive?: boolean;
}

interface Base {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Shown (and validated) only when another field has this value. */
  showIf?: { field: string; equals: string };
  patient?: PatientKey;
  /** Copied into the card's notes as "notesLabel: answer". */
  notesLabel?: string;
}

export type Field =
  | (Base & { type: "text" | "textarea"; maxLength?: number; pattern?: string; patternMessage?: string; placeholder?: string })
  | (Base & { type: "tel" | "email" | "date" | "pesel"; placeholder?: string })
  | (Base & { type: "choice" | "multi"; options: Option[] })
  | (Base & { type: "consent"; details?: string });

export interface Step {
  id: string;
  title: string;
  intro?: string;
  fields: Field[];
}

export interface IntakeForm {
  version: string;
  title: string;
  steps: Step[];
}

const YES_NO: Option[] = [
  { value: "tak", label: "Tak" },
  { value: "nie", label: "Nie" },
];

export const FORM: IntakeForm = {
  version: "sample-1",
  title: "Formularz rejestracyjny pacjenta",
  steps: [
    {
      id: "personal",
      title: "Dane pacjenta",
      intro: "Prosimy o wypełnienie formularza. Pola oznaczone gwiazdką są wymagane.",
      fields: [
        { id: "firstName", type: "text", label: "Imię", required: true, maxLength: 60, patient: "firstName" },
        { id: "lastName", type: "text", label: "Nazwisko", required: true, maxLength: 80, patient: "lastName" },
        { id: "birthDate", type: "date", label: "Data urodzenia", required: true, patient: "birthDate" },
        { id: "pesel", type: "pesel", label: "PESEL", hint: "Opcjonalnie. Przyspiesza wystawianie dokumentów." },
        { id: "phone", type: "tel", label: "Telefon", required: true, placeholder: "np. 600 100 200", patient: "phone" },
        { id: "email", type: "email", label: "E-mail", placeholder: "np. jan@poczta.pl", patient: "email" },
        { id: "street", type: "text", label: "Ulica i numer", maxLength: 120 },
        {
          id: "postalCode",
          type: "text",
          label: "Kod pocztowy",
          maxLength: 6,
          pattern: "^\\d{2}-\\d{3}$",
          patternMessage: "Wpisz kod w formacie 00-000.",
          placeholder: "00-000",
        },
        { id: "city", type: "text", label: "Miejscowość", maxLength: 80 },
      ],
    },
    {
      id: "health",
      title: "Stan zdrowia",
      intro: "Te informacje pomagają lekarzowi bezpiecznie zaplanować leczenie.",
      fields: [
        {
          id: "conditions",
          type: "multi",
          label: "Czy choruje Pan/Pani na którąś z poniższych chorób?",
          required: true,
          options: [
            { value: "heart", label: "Choroby serca", flag: "Choroby serca" },
            { value: "hypertension", label: "Nadciśnienie", flag: "Nadciśnienie" },
            { value: "diabetes", label: "Cukrzyca", flag: "Cukrzyca" },
            { value: "asthma", label: "Astma", flag: "Astma" },
            { value: "epilepsy", label: "Padaczka", flag: "Padaczka" },
            { value: "bleeding", label: "Zaburzenia krzepnięcia krwi", flag: "Zaburzenia krzepnięcia" },
            { value: "thyroid", label: "Choroby tarczycy", flag: "Choroby tarczycy" },
            { value: "infectious", label: "WZW lub HIV", flag: "Choroba zakaźna" },
            { value: "none", label: "Żadna z powyższych", exclusive: true },
          ],
        },
        {
          id: "allergies",
          type: "choice",
          label: "Czy ma Pan/Pani alergie (np. na leki, lateks, znieczulenie)?",
          required: true,
          options: [{ value: "tak", label: "Tak", flag: "Alergia" }, YES_NO[1]],
        },
        {
          id: "allergyDetails",
          type: "text",
          label: "Na co?",
          required: true,
          maxLength: 200,
          showIf: { field: "allergies", equals: "tak" },
          notesLabel: "Alergie",
        },
        {
          id: "medications",
          type: "textarea",
          label: "Jakie leki przyjmuje Pan/Pani na stałe?",
          hint: "Zostaw puste, jeśli żadnych.",
          maxLength: 1000,
          notesLabel: "Przyjmowane leki",
        },
        {
          id: "anesthesia",
          type: "choice",
          label: "Czy miał(a) Pan/Pani kiedyś złe samopoczucie po znieczuleniu u dentysty?",
          required: true,
          options: [{ value: "tak", label: "Tak", flag: "Reakcja na znieczulenie" }, YES_NO[1]],
        },
        {
          id: "pregnancy",
          type: "choice",
          label: "Czy jest Pani w ciąży?",
          required: true,
          options: [
            { value: "tak", label: "Tak", flag: "Ciąża" },
            { value: "nie", label: "Nie" },
            { value: "nd", label: "Nie dotyczy" },
          ],
        },
      ],
    },
    {
      id: "consents",
      title: "Zgody",
      fields: [
        {
          id: "privacy",
          type: "consent",
          label: "Zapoznałem(-am) się z informacją o przetwarzaniu danych osobowych.",
          required: true,
          details:
            "Administratorem danych jest DentaPlus+. Dane przetwarzamy w celu udzielania świadczeń zdrowotnych i prowadzenia dokumentacji medycznej (art. 9 ust. 2 lit. h RODO). Przysługuje Panu/Pani prawo dostępu do danych, ich sprostowania i ograniczenia przetwarzania. (Treść przykładowa, do uzupełnienia przez klinikę.)",
        },
        {
          id: "truthful",
          type: "consent",
          label: "Oświadczam, że podane informacje są zgodne z prawdą.",
          required: true,
        },
        {
          id: "smsConsent",
          type: "consent",
          label: "Chcę dostawać SMS-em przypomnienia o wizytach.",
          patient: "smsConsent",
        },
      ],
    },
  ],
};

const DEFAULT_MAX = { text: 200, textarea: 2000 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Polish national id: 11 digits with a check digit. */
export function validPesel(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(pesel[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(pesel[10]);
}

/** Birth date encoded in a PESEL ("YYYY-MM-DD"), or null. */
export function peselBirthDate(pesel: string): string | null {
  if (!validPesel(pesel)) return null;
  const yy = Number(pesel.slice(0, 2));
  let mm = Number(pesel.slice(2, 4));
  const dd = pesel.slice(4, 6);
  const century = [1900, 2000, 2100, 2200, 1800][Math.floor(mm / 20)];
  mm %= 20;
  return `${century + yy}-${String(mm).padStart(2, "0")}-${dd}`;
}

/** "YYYY-MM-DD" naming a day that exists (no 31 February). */
export function realDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

export function isVisible(field: Field, answers: Answers): boolean {
  return !field.showIf || answers[field.showIf.field] === field.showIf.equals;
}

const isEmpty = (v: Answer | undefined) =>
  v === undefined || v === false || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** Checks one visible field. Returns its cleaned value (undefined = left out) or an error message. */
function checkField(field: Field, raw: Answer | undefined, today: string): { value?: Answer; error?: string } {
  if (isEmpty(raw)) return field.required ? { error: field.type === "consent" ? "Ta zgoda jest wymagana." : "To pole jest wymagane." } : {};
  switch (field.type) {
    case "consent":
      return raw === true ? { value: true } : { error: "Nieprawidłowa odpowiedź." };
    case "choice":
      return typeof raw === "string" && field.options.some((o) => o.value === raw)
        ? { value: raw }
        : { error: "Wybierz jedną z odpowiedzi." };
    case "multi": {
      if (!Array.isArray(raw) || raw.some((v) => !field.options.some((o) => o.value === v))) {
        return { error: "Nieprawidłowa odpowiedź." };
      }
      const values = [...new Set(raw)];
      const exclusive = field.options.filter((o) => o.exclusive).map((o) => o.value);
      if (values.length > 1 && values.some((v) => exclusive.includes(v))) {
        return { error: "„Żadna z powyższych” nie łączy się z innymi odpowiedziami." };
      }
      return { value: values };
    }
  }
  if (typeof raw !== "string") return { error: "Nieprawidłowa odpowiedź." };
  const text = raw.trim();
  switch (field.type) {
    case "tel": {
      const phone = normalizePhone(text);
      return phone ? { value: phone } : { error: "Wpisz numer telefonu, np. 600 100 200." };
    }
    case "email":
      return text.length <= 120 && EMAIL.test(text) ? { value: text.toLowerCase() } : { error: "Wpisz poprawny adres e-mail." };
    case "pesel": {
      const digits = text.replace(/\s/g, "");
      return validPesel(digits) ? { value: digits } : { error: "Ten PESEL jest nieprawidłowy." };
    }
    case "date":
      return realDate(text) && text >= "1900-01-01" && text <= today
        ? { value: text }
        : { error: "Wpisz poprawną datę." };
    default: {
      const max = field.maxLength ?? DEFAULT_MAX[field.type];
      if (text.length > max) return { error: `Najwyżej ${max} znaków.` };
      if (field.pattern && !new RegExp(field.pattern).test(text)) return { error: field.patternMessage ?? "Nieprawidłowy format." };
      return { value: field.type === "textarea" ? text : text.replace(/\s+/g, " ") };
    }
  }
}

export interface Checked {
  values: Answers;
  errors: Record<string, string>;
}

/**
 * Validates answers against the form (or one step of it). Unknown keys and hidden fields are
 * dropped, text is trimmed, phones become E.164.
 */
export function validateAnswers(form: IntakeForm, answers: Answers, opts: { step?: number; today?: string } = {}): Checked {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const steps = opts.step === undefined ? form.steps : [form.steps[opts.step]];
  const values: Answers = {};
  const errors: Record<string, string> = {};
  for (const step of steps) {
    for (const field of step.fields) {
      if (!isVisible(field, answers)) continue;
      const { value, error } = checkField(field, answers[field.id], today);
      if (error) errors[field.id] = error;
      else if (value !== undefined) values[field.id] = value;
    }
  }
  // A PESEL must agree with the birth date given next to it.
  const pesel = values.pesel;
  if (typeof pesel === "string" && typeof values.birthDate === "string" && peselBirthDate(pesel) !== values.birthDate) {
    errors.pesel = "PESEL nie zgadza się z datą urodzenia.";
  }
  return { values, errors };
}

export interface PatientDraft {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  smsConsent: boolean;
  medicalFlags: string[];
  /** Lines for the card's notes ("Alergie: penicylina"); empty when nothing to add. */
  notes: string[];
}

/** What an accepted registration puts on the patient card. Expects answers from validateAnswers. */
export function toPatient(form: IntakeForm, answers: Answers): PatientDraft {
  const draft: PatientDraft = {
    firstName: "",
    lastName: "",
    phone: null,
    email: null,
    birthDate: null,
    smsConsent: false,
    medicalFlags: [],
    notes: [],
  };
  for (const field of form.steps.flatMap((s) => s.fields)) {
    const value = answers[field.id];
    if (value === undefined || !isVisible(field, answers)) continue;
    if (field.patient === "smsConsent") draft.smsConsent = value === true;
    else if (field.patient && typeof value === "string") draft[field.patient] = value;
    if (field.type === "choice" || field.type === "multi") {
      const chosen = Array.isArray(value) ? value : [value];
      for (const option of field.options) {
        if (option.flag && chosen.includes(option.value)) draft.medicalFlags.push(option.flag);
      }
    }
    if (field.notesLabel && typeof value === "string") draft.notes.push(`${field.notesLabel}: ${value}`);
  }
  draft.medicalFlags = [...new Set(draft.medicalFlags)];
  return draft;
}
