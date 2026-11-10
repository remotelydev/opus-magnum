import { useEffect, useState } from "react";
import { api, STATUS_LABEL, type AppointmentStatus, type HistoryEntry } from "../lib/api.ts";

const ACTION_LABEL: Record<string, string> = {
  "patient.create": "dodał(a) pacjenta",
  "patient.update": "zmienił(a) dane pacjenta",
  "patient.view": "otworzył(a) kartę",
  "appointment.create": "umówił(a) wizytę",
  "appointment.update": "zmienił(a) wizytę",
};

const FIELD_LABEL: Record<string, string> = {
  firstName: "imię",
  lastName: "nazwisko",
  phone: "telefon",
  email: "e-mail",
  birthDate: "data urodzenia",
  medicalFlags: "flagi medyczne",
  notes: "notatka",
  smsConsent: "zgoda SMS",
  startsAt: "termin",
  endsAt: "koniec",
  staffId: "lekarz",
  siteId: "placówka",
  status: "status",
  serviceId: "usługa",
  title: "opis",
};

const historyTime = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function describe(entry: HistoryEntry): string {
  const what = ACTION_LABEL[entry.action] ?? entry.action;
  const fields = Array.isArray(entry.changes?.fields)
    ? (entry.changes.fields as string[]).map((f) => FIELD_LABEL[f] ?? f).join(", ")
    : "";
  const status = typeof entry.changes?.status === "string" ? STATUS_LABEL[entry.changes.status as AppointmentStatus] : "";
  const detail = status ? `status: ${status}` : fields;
  const visit = entry.entity === "appointment" ? ` nr ${entry.entityId}` : "";
  return `${what}${visit}${detail ? ` (${detail})` : ""}`;
}

export function PatientHistory({ patientId }: { patientId: number }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.patientHistory(patientId).then(setEntries).catch((err) => setError((err as Error).message));
  }, [patientId]);
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!entries) return <p className="text-xs text-muted-foreground">Ładowanie…</p>;
  if (!entries.length) return <p className="text-xs text-muted-foreground">Brak wpisów.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {entries.map((e) => (
        <li key={e.id}>
          <span className="text-muted-foreground">{historyTime.format(new Date(e.at))}</span> ·{" "}
          {e.userName ?? "system"} {describe(e)}
        </li>
      ))}
    </ul>
  );
}
