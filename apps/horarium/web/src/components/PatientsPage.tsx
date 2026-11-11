import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { StatusBadge } from "@opus-magnum/dentaplus-ui/components/status";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Appointment, type Patient, type PatientPage, type Site, type Staff } from "../lib/api.ts";
import { formatMinutes, toClinicTime } from "../lib/time.ts";
import { PatientHistory } from "./PatientHistory.tsx";

type PatientCard = Patient & { appointments: Appointment[] };

interface Props {
  sites: Site[];
  staff: Staff[];
  canEdit: boolean;
  canSeeHistory: boolean;
  /** Jump to the calendar on the day and site of a visit. */
  onOpenDay: (site: string, date: string) => void;
}

const dateFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const formatDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

const PAGE_SIZE = 25;

export function PatientsPage({ sites, staff, canEdit, canSeeHistory, onOpenDay }: Props) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PatientPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Typing narrows the list after a short pause and starts again from page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api
      .listPatients(query, page, PAGE_SIZE)
      .then((r) => {
        if (!current) return;
        setResult(r);
        setError(null);
      })
      .catch((e: Error) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [query, page, reloadKey]);

  const backToList = () => {
    setSelected(null);
    setReloadKey((k) => k + 1);
  };

  if (selected !== null) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto mb-4 max-w-4xl">
          <Button size="sm" variant="outline" onClick={backToList}>
            ← Lista pacjentów
          </Button>
        </div>
        {selected === "new" ? (
          <PatientForm onCancel={backToList} onSaved={(id) => setSelected(id)} />
        ) : (
          <PatientCardView
            key={selected}
            id={selected}
            sites={sites}
            staff={staff}
            canEdit={canEdit}
            canSeeHistory={canSeeHistory}
            onOpenDay={onOpenDay}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        )}
      </main>
    );
  }

  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="patient-search">Szukaj pacjenta</Label>
            <Input
              id="patient-search"
              type="search"
              placeholder="Nazwisko, imię albo numer telefonu"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </div>
          {canEdit && (
            <Button variant="outline" onClick={() => setSelected("new")}>
              + Nowy pacjent
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Nazwisko i imię</th>
                <th className="w-44 px-3 py-2 font-medium">Telefon</th>
                <th className="hidden w-40 px-3 py-2 font-medium sm:table-cell">Data urodzenia</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-border ${loading ? "opacity-60" : ""}`}>
              {result?.items.map((p) => (
                <tr
                  key={p.id}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => setSelected(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(p.id);
                    }
                  }}
                >
                  <td className="px-3 py-2 font-medium">
                    {p.lastName} {p.firstName}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {p.phone ?? <span className="text-muted-foreground">brak</span>}
                  </td>
                  <td className="hidden px-3 py-2 tabular-nums sm:table-cell">
                    {p.birthDate ? formatDate(p.birthDate) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              {result && result.items.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    {query ? `Nikogo nie znaleziono dla „${query}”.` : "Brak pacjentów."}
                  </td>
                </tr>
              )}
              {!result && !error && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    Ładowanie…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Strony listy pacjentów">
          <span className="text-muted-foreground">{total ? `${from}–${to} z ${total}` : "0 pacjentów"}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Poprzednia
            </Button>
            <span className="tabular-nums">
              Strona {page} z {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Następna →
            </Button>
          </div>
        </nav>
      </div>
    </main>
  );
}

function PatientCardView({
  id,
  sites,
  staff,
  canEdit,
  canSeeHistory,
  onOpenDay,
  onChanged,
}: Omit<Props, "onOpenDay"> & {
  id: number;
  onOpenDay: Props["onOpenDay"];
  onChanged: (name: string) => void;
}) {
  const [card, setCard] = useState<PatientCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(() => {
    api
      .patient(id)
      .then(setCard)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!card) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  if (editing) {
    return (
      <PatientForm
        patient={card}
        onCancel={() => setEditing(false)}
        onSaved={(_, name) => {
          setEditing(false);
          setHistoryKey((k) => k + 1);
          onChanged(name);
          load();
        }}
      />
    );
  }

  const now = Date.now();
  const upcoming = card.appointments.filter((a) => new Date(a.startsAt).getTime() >= now).reverse();
  const past = card.appointments.filter((a) => new Date(a.startsAt).getTime() < now);
  const doctor = (staffId: number) => staff.find((s) => s.id === staffId)?.name ?? "?";
  const siteName = (siteId: string) => sites.find((s) => s.id === siteId)?.name ?? siteId;

  const visitList = (list: Appointment[]) => (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
      {list.map((a) => {
        const t = toClinicTime(a.startsAt);
        return (
          <li key={a.id}>
            <button
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted"
              onClick={() => onOpenDay(a.siteId, t.date)}
              title="Pokaż ten dzień w terminarzu"
            >
              <span className="w-40 tabular-nums">
                {formatDate(t.date)}, {formatMinutes(t.minutes)}
              </span>
              <span className="min-w-40 flex-1">{a.serviceName ?? a.title ?? "Wizyta"}</span>
              <span className="text-muted-foreground">
                {doctor(a.staffId)} · {siteName(a.siteId)}
              </span>
              <StatusBadge status={a.status} />
              {a.notes && <span className="basis-full text-xs text-muted-foreground">{a.notes}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <h1 className="text-lg font-semibold">
            {card.firstName} {card.lastName}
          </h1>
          <p>
            Tel.: {card.phone ? <a href={`tel:${card.phone}`}>{card.phone}</a> : "brak"}
            {card.smsConsent ? " · zgoda na SMS" : " · bez zgody na SMS"}
          </p>
          {card.email && <p>E-mail: {card.email}</p>}
          {card.birthDate && <p>Data urodzenia: {formatDate(card.birthDate)}</p>}
          {card.medicalFlags.length > 0 && <p className="text-destructive">Uwaga: {card.medicalFlags.join(", ")}</p>}
          {card.notes && <p className="text-muted-foreground">{card.notes}</p>}
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edytuj dane
          </Button>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Nadchodzące wizyty</h2>
        {upcoming.length ? visitList(upcoming) : <p className="text-sm text-muted-foreground">Brak.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Wcześniejsze wizyty ({past.length})</h2>
        {past.length ? visitList(past) : <p className="text-sm text-muted-foreground">Brak.</p>}
      </section>

      {canSeeHistory && (
        <details className="border-t border-border pt-3" onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-sm font-medium">Historia zmian</summary>
          <div className="mt-2">{historyOpen && <PatientHistory key={historyKey} patientId={card.id} />}</div>
        </details>
      )}
    </div>
  );
}

function PatientForm({
  patient,
  onCancel,
  onSaved,
}: {
  patient?: Patient;
  onCancel: () => void;
  onSaved: (id: number, name: string) => void;
}) {
  const [form, setForm] = useState({
    firstName: patient?.firstName ?? "",
    lastName: patient?.lastName ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    birthDate: patient?.birthDate?.slice(0, 10) ?? "",
    medicalFlags: patient?.medicalFlags.join(", ") ?? "",
    notes: patient?.notes ?? "",
    smsConsent: patient?.smsConsent ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm({ ...form, [key]: value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Podaj imię i nazwisko.");
    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      birthDate: form.birthDate || null,
      medicalFlags: form.medicalFlags
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      notes: form.notes.trim() || null,
      smsConsent: form.smsConsent,
    };
    setBusy(true);
    setError(null);
    try {
      if (patient) {
        // Send only what changed, so the change log names the fields really edited.
        const before: Record<string, unknown> = { ...patient, birthDate: patient.birthDate?.slice(0, 10) ?? null };
        const changed = Object.fromEntries(
          Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k] ?? null)),
        );
        if (Object.keys(changed).length) await api.updatePatient(patient.id, changed);
        onSaved(patient.id, body.lastName);
      } else {
        onSaved((await api.createPatient(body)).id, body.lastName);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "firstName" | "lastName" | "phone" | "email" | "birthDate", label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`pf-${key}`}>{label}</Label>
      <Input id={`pf-${key}`} type={type} value={form[key]} onChange={(e) => set(key)(e.target.value)} />
    </div>
  );

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">{patient ? "Edycja danych pacjenta" : "Nowy pacjent"}</h1>
      <div className="grid grid-cols-2 gap-3">
        {field("firstName", "Imię")}
        {field("lastName", "Nazwisko")}
        {field("phone", "Telefon", "tel")}
        {field("email", "E-mail", "email")}
        {field("birthDate", "Data urodzenia", "date")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-flags">Flagi medyczne (po przecinku, np. alergia na penicylinę, cukrzyca)</Label>
        <Input id="pf-flags" value={form.medicalFlags} onChange={(e) => set("medicalFlags")(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-notes">Notatka organizacyjna</Label>
        <textarea
          id="pf-notes"
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
          className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.smsConsent} onChange={(e) => set("smsConsent")(e.target.checked)} />
        Zgoda na przypomnienia SMS
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {patient ? "Zapisz zmiany" : "Dodaj pacjenta"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
