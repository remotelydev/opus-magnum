// Made-up patients in the shape of the Versum export (scripts/versum/extract-patients.js), for the demo
// database and the preview: they go through the real importer, so the preview shows imported cards.
// Every name, number and note is invented; nothing is copied from Versum.
import type { VersumPatientRecord } from "../../src/versum-patients.js";

const PEOPLE: [first: string, last: string, gender: "female" | "male"][] = [
  ["Halina", "Wierzbięta", "female"], ["Zdzisław", "Pomorski", "male"], ["Genowefa", "Ostrowiak", "female"],
  ["Ryszard", "Kmiecik", "male"], ["Bożena", "Lipińska-Ruta", "female"], ["Czesław", "Mrozik", "male"],
  ["Irena", "Sobańska", "female"], ["Waldemar", "Tokarczyk", "male"], ["Teresa", "Gackowska", "female"],
  ["Leszek", "Bartnicki", "male"], ["Danuta", "Krzemińska", "female"], ["Eugeniusz", "Wolański", "male"],
];
const DESCRIPTIONS = [
  "Pacjentka boi się borowania, prosi o znieczulenie przy każdym zabiegu.",
  "Preferuje wizyty po 15:00 (praca zmianowa).\nPłaci zawsze kartą.",
  "Leczenie ortodontyczne zakończone 2021, retainer górny.",
  "Przychodzi z wnukiem, umawiać wizyty jedna po drugiej.",
  "Prosi o kontakt tylko SMS, nie odbiera nieznanych numerów.",
  "Wrażliwe szyjki zębowe, pasta znieczulająca przed skalingiem.",
];
const CITIES: [street: string, zip: string, city: string][] = [
  ["Kaliska", "62-700", "Turek"], ["Łęczycka", "99-200", "Poddębice"], ["Polna", "62-704", "Kawęczyn"],
  ["Kolejowa", "62-720", "Brudzew"], ["Zielona", "99-210", "Uniejów"],
];
const ORIGINS = [["3", "Polecenie przez innego klienta"], ["1", "Facebook"], ["5", "Reklama w internecie"]];

/** A PESEL-shaped number with a valid checksum for a birth date (made up, not a real person's). */
function fakePesel(y: number, m: number, d: number, serial: number, female: boolean): string {
  const month = m + (y >= 2000 ? 20 : 0);
  const sex = (serial % 5) * 2 + (female ? 0 : 1);
  const base = `${String(y % 100).padStart(2, "0")}${String(month).padStart(2, "0")}${String(d).padStart(2, "0")}${String(serial).padStart(3, "0")}${sex}`;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = [...base].reduce((acc, c, i) => acc + Number(c) * weights[i], 0);
  return base + String((10 - (sum % 10)) % 10);
}

export function demoVersumPatients(): VersumPatientRecord[] {
  return PEOPLE.map(([first, last, gender], i) => {
    const y = 1948 + i * 5;
    const m = 1 + ((i * 5) % 12);
    const d = 3 + i * 2;
    const [street, zip, city] = CITIES[i % CITIES.length];
    const origin = ORIGINS[i % ORIGINS.length];
    const flags = { anesthesia: i % 2 === 0, pregnancy: false, heart_disease: i % 4 === 1, hypertension: i % 3 === 0,
      thyroid_disease: i === 4, diabetes: i % 5 === 2, epilepsy: false, jaundice: i === 7 };
    return {
      id: String(90000001 + i),
      fields: {
        firstname: first,
        lastname: last,
        gender,
        email: i % 3 === 0 ? `${first.toLowerCase()}.demo${i}@example.com` : "",
        mobile: `+48 5${String(10 + i).padStart(2, "0")} 000 ${String(100 + i * 7).padStart(3, "0")}`,
        phone_number: "",
        birth_date_year: String(y), birth_date_month: String(m), birth_date_day: String(d),
        street_name: street, house_number: String(3 + i), unit_number: i % 3 === 1 ? String(i + 1) : "",
        zip_code: zip, city, country_iso2: "PL", province_id: "5",
        name_day_month: String(m), name_day_day: String(Math.min(28, d + 4)),
        ...flags,
        allergies: i % 4 === 0 ? "penicylina" : "",
        other_disease: i === 6 ? "astma" : "",
        "customer_group_ids[]": i % 3 === 0 ? ["11"] : [],
        customer_origin_id: origin[0],
        recommendation_customer_id: i > 0 && origin[0] === "3" ? String(90000001 + i - 1) : "",
        pesel: i % 4 === 3 ? "" : fakePesel(y, m, d, 100 + i * 37, gender === "female"),
        tax_id: i === 5 ? "6680000000" : "",
        card: String(5001 + i),
        description: DESCRIPTIONS[i % DESCRIPTIONS.length],
        send_reminder_sms: i !== 9, send_reminder_email: i % 3 === 0,
        send_newsletter_sms: i % 2 === 0, send_newsletter_email: false, send_wishes_sms: false, send_wishes_email: false,
        "agreements_accepted_content_ids[]": i % 2 === 0 ? ["37519", "37520"] : ["37519"],
      },
      labels: {
        gender: gender === "female" ? "Kobieta" : "Mężczyzna",
        country_iso2: "Polska",
        province_id: "łódzkie",
        customer_origin_id: origin[1],
        "customer_group_ids[]": i % 3 === 0 ? ["Stali pacjenci"] : [],
      },
      agreements: { "37519": "notice", "37520": i % 2 === 0 },
      shown: {
        "Data dodania": `${String(1 + i).padStart(2, "0")}.0${1 + (i % 9)}.20${String(14 + (i % 10)).padStart(2, "0")} 10:${String(i * 4).padStart(2, "0")}`,
        "Ostatnia modyfikacja": "02.11.2026 09:15",
      },
      fetchedAt: "2026-11-22T12:00:00.000Z",
    };
  });
}
