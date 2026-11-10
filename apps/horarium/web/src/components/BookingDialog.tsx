import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label, Select } from "@opus-magnum/dentaplus-ui/components/field";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Patient, type PatientSummary, type Service, type Staff } from "../lib/api.ts";
import { formatMinutes, fromClinicTime, parseHhmm } from "../lib/time.ts";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";

interface Props {
  site: string;
  date: string;
  staff: Staff[];
  services: Service[];
  initial: { staffId: number; startMin: number };
  onClose: () => void;
  onBooked: (message: string) => void;
}

const CUSTOM = "custom";

export function BookingDialog({ site, date, staff, services, initial, onClose, onBooked }: Props) {
  const [staffId, setStaffId] = useState(initial.staffId);
  const [start, setStart] = useState(formatMinutes(initial.startMin));
  const [serviceId, setServiceId] = useState<string>(services[0] ? String(services[0].id) : CUSTOM);
  const [customTitle, setCustomTitle] = useState("");
  const [customMinutes, setCustomMinutes] = useState(30);
  const [notes, setNotes] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({ firstName: "", lastName: "", phone: "", smsConsent: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const s of services) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
    return [...groups.entries()];
  }, [services]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const startMin = parseHhmm(start);
    if (startMin === null) return setError("Godzina w formacie GG:MM, np. 9:15.");
    setBusy(true);
    try {
      let patientId = patient?.id ?? null;
      if (!patientId && creatingPatient) {
        const created = await api.createPatient({
          firstName: newPatient.firstName.trim(),
          lastName: newPatient.lastName.trim(),
          phone: newPatient.phone.trim() || null,
          smsConsent: newPatient.smsConsent,
        });
        patientId = created.id;
      }
      if (!patientId) {
        setBusy(false);
        return setError("Wybierz pacjenta albo dodaj nowego.");
      }
      const startsAt = fromClinicTime(date, startMin);
      const custom = serviceId === CUSTOM;
      const res = await api.createAppointment({
        siteId: site,
        staffId,
        patientId,
        serviceId: custom ? null : Number(serviceId),
        title: custom ? customTitle.trim() || "Usługa spoza cennika" : null,
        startsAt: startsAt.toISOString(),
        endsAt: custom ? new Date(startsAt.getTime() + customMinutes * 60_000).toISOString() : undefined,
        notes: notes.trim() || null,
      });
      onBooked(res.warnings.length ? `Umówiono. Uwaga: ${res.warnings.join(" ")}` : "Umówiono wizytę.");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nowa wizyta" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <PatientPicker
          patient={patient}
          onPick={(p) => {
            setPatient(p);
            setCreatingPatient(false);
          }}
          creating={creatingPatient}
          onCreate={() => {
            setPatient(null);
            setCreatingPatient(true);
          }}
        />
        {creatingPatient && (
          <fieldset className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Nowy pacjent</legend>
            <Input
              placeholder="Imię"
              value={newPatient.firstName}
              onChange={(e) => setNewPatient({ ...newPatient, firstName: e.target.value })}
              required
            />
            <Input
              placeholder="Nazwisko"
              value={newPatient.lastName}
              onChange={(e) => setNewPatient({ ...newPatient, lastName: e.target.value })}
              required
            />
            <Input
              placeholder="Telefon"
              value={newPatient.phone}
              onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={newPatient.smsConsent}
                onChange={(e) => setNewPatient({ ...newPatient, smsConsent: e.target.checked })}
              />
              Zgoda na SMS
            </label>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="b-staff">Lekarz</Label>
            <Select
              id="b-staff"
              value={staffId}
              onChange={(e) => setStaffId(Number(e.target.value))}
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-start">Godzina</Label>
            <Input id="b-start" value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="b-service">Usługa</Label>
          <Select
            id="b-service"
            className="h-8 w-full border border-border bg-background px-2 text-sm"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            {byCategory.map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.durationMinutes} min
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM}>Usługa spoza cennika…</option>
          </Select>
        </div>
        {serviceId === CUSTOM && (
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Input placeholder="Opis" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
            <Input
              type="number"
              min={5}
              step={5}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(Number(e.target.value))}
              aria-label="Czas w minutach"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="b-notes">Notatka</Label>
          <Input id="b-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Zapisywanie…" : "Umów"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PatientPicker({
  patient,
  onPick,
  creating,
  onCreate,
}: {
  patient: Patient | null;
  onPick: (p: Patient | null) => void;
  creating: boolean;
  onCreate: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PatientSummary[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchPatients(q.trim())
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  if (patient) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
        <span>
          <strong>
            {patient.firstName} {patient.lastName}
          </strong>{" "}
          <span className="text-muted-foreground">{patient.phone}</span>
          {patient.medicalFlags.length > 0 && (
            <span className="ml-2 text-xs text-destructive">{patient.medicalFlags.join(", ")}</span>
          )}
        </span>
        <Button type="button" variant="link" size="sm" onClick={() => {
            setQ("");
            onPick(null);
          }}>
          Zmień
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor="b-patient">Pacjent</Label>
      <Input
        id="b-patient"
        placeholder="Nazwisko albo telefon"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="max-h-48 overflow-auto rounded-md border border-border text-sm">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-muted"
                // Pick loads the full card, so reception sees medical flags before booking.
                onClick={() =>
                  api
                    .patient(p.id)
                    .then(onPick)
                    .catch(() => onPick({ ...p, email: null, medicalFlags: [], notes: null, smsConsent: false }))
                }
              >
                {p.lastName} {p.firstName} <span className="text-muted-foreground">{p.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!creating && (
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onCreate}>
          + Nowy pacjent
        </Button>
      )}
    </div>
  );
}
