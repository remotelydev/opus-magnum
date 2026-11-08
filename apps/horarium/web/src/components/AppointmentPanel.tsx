import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { useEffect, useState } from "react";
import { api, STATUS_LABEL, type Appointment, type AppointmentStatus, type Patient, type Staff } from "../lib/api.ts";
import { formatMinutes, fromClinicTime, parseHhmm, toClinicTime } from "../lib/time.ts";

interface Props {
  appointment: Appointment;
  staff: Staff[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}

const STATUS_ACTIONS: AppointmentStatus[] = ["confirmed", "done", "no_show", "cancelled", "booked"];

export function AppointmentPanel({ appointment: a, staff, canEdit, onClose, onChanged }: Props) {
  const start = toClinicTime(a.startsAt);
  const end = toClinicTime(a.endsAt);
  const [patient, setPatient] = useState<(Patient & { appointments: Appointment[] }) | null>(null);
  const [time, setTime] = useState(formatMinutes(start.minutes));
  const [length, setLength] = useState(end.minutes - start.minutes);
  const [notes, setNotes] = useState(a.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (a.patientId) api.patient(a.patientId).then(setPatient).catch(() => setPatient(null));
  }, [a.patientId]);

  const run = async (body: Parameters<typeof api.updateAppointment>[1], done: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateAppointment(a.id, body);
      onChanged(res.warnings.length ? `${done} Uwaga: ${res.warnings.join(" ")}` : done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveTime = () => {
    const minutes = parseHhmm(time);
    if (minutes === null || length < 5) return setError("Godzina w formacie GG:MM i czas co najmniej 5 min.");
    const startsAt = fromClinicTime(start.date, minutes);
    run(
      { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + length * 60_000).toISOString() },
      "Zmieniono godzinę.",
    );
  };

  const history = patient?.appointments.filter((x) => x.id !== a.id).slice(0, 5) ?? [];
  const doctor = staff.find((s) => s.id === a.staffId)?.name ?? "";

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 text-sm" aria-label="Szczegóły wizyty">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-medium">{a.patientName ?? a.title ?? "Blokada"}</h2>
          <p className="text-muted-foreground">
            {formatMinutes(start.minutes)}–{formatMinutes(end.minutes)} · {doctor}
          </p>
          <p className="text-muted-foreground">
            {a.serviceName ?? a.title ?? "Usługa spoza cennika"} · {STATUS_LABEL[a.status]}
            {a.source === "bot" ? " · umówione przez bota" : ""}
          </p>
        </div>
        <button onClick={onClose} aria-label="Zamknij" className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>

      {patient && (
        <section className="space-y-1">
          <p>
            Tel.: {patient.phone ? <a href={`tel:${patient.phone}`}>{patient.phone}</a> : "brak"}
            {!patient.smsConsent && <span className="ml-2 text-xs text-muted-foreground">(bez zgody SMS)</span>}
          </p>
          {patient.medicalFlags.length > 0 && (
            <p className="text-destructive">Uwaga: {patient.medicalFlags.join(", ")}</p>
          )}
          {patient.notes && <p className="text-muted-foreground">{patient.notes}</p>}
        </section>
      )}

      {canEdit && (
        <>
          <section className="flex flex-wrap gap-1.5">
            {STATUS_ACTIONS.filter((s) => s !== a.status).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === "cancelled" ? "destructive" : "outline"}
                disabled={busy}
                onClick={() => run({ status: s }, `Status: ${STATUS_LABEL[s]}.`)}
              >
                {s === "booked" ? "Przywróć" : STATUS_LABEL[s]}
              </Button>
            ))}
          </section>

          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="p-time">Godzina</Label>
                <Input id="p-time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-len">Czas (min)</Label>
                <Input
                  id="p-len"
                  type="number"
                  min={5}
                  step={5}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                />
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={saveTime}>
              Zapisz godzinę
            </Button>
          </section>

          <section className="space-y-1">
            <Label htmlFor="p-notes">Notatka</Label>
            <Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || notes === (a.notes ?? "")}
              onClick={() => run({ notes: notes.trim() || null }, "Zapisano notatkę.")}
            >
              Zapisz notatkę
            </Button>
          </section>
        </>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Inne wizyty pacjenta</h3>
          <ul className="space-y-0.5 text-xs">
            {history.map((h) => (
              <li key={h.id}>
                {toClinicTime(h.startsAt).date} · {h.serviceName ?? h.title ?? "wizyta"} · {STATUS_LABEL[h.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
