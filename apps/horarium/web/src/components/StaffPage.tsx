import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label, Select } from "@opus-magnum/dentaplus-ui/components/field";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Site, type Staff, type StaffInput } from "../lib/api.ts";

const EMPTY: StaffInput = {
  name: "",
  kind: "person",
  title: null,
  phone: null,
  email: null,
  active: true,
  sortOrder: 0,
  sites: [],
};

/** Settings → staff: everyone who can have a column in the calendar. */
export function StaffPage({ onOpenSchedule }: { onOpenSchedule: (staffId: number) => void }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [filter, setFilter] = useState("");
  const [site, setSite] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.staff(), api.sites()])
      .then(([st, si]) => {
        setStaff(st);
        setSites(si);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return staff.filter(
      (s) =>
        (showInactive || s.active) &&
        (!site || s.sites.includes(site)) &&
        (!q || `${s.name} ${s.title ?? ""}`.toLowerCase().includes(q)),
    );
  }, [staff, filter, site, showInactive]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Pracownicy</h1>
          <div className="w-56">
            <Input
              className="h-8"
              placeholder="Szukaj pracownika"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Szukaj pracownika"
            />
          </div>
          <div className="w-40">
            <Select className="h-8" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Placówka">
              <option value="">Wszystkie placówki</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Pokaż nieaktywnych
          </label>
          <Button className="ml-auto" size="sm" onClick={() => setEditing("new")}>
            + Dodaj pracownika
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Każda aktywna osoba lub kalendarz (np. Higienizacja) ma własną kolumnę w terminarzu swoich placówek. Jedna
          osoba może pracować w obu placówkach, bez dublowania wpisu.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Imię i nazwisko</th>
                <th className="px-3 py-2 font-medium">Placówki</th>
                <th className="px-3 py-2 font-medium">Kontakt</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={`border-b border-border last:border-0 ${s.active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.kind === "calendar" ? "kalendarz (nie osoba)" : s.title || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.sites.map((id) => siteName.get(id) ?? id).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {s.phone && <div>{s.phone}</div>}
                    {s.email && <div>{s.email}</div>}
                    {!s.phone && !s.email && "—"}
                  </td>
                  <td className="w-28 px-3 py-2 text-xs text-muted-foreground">{s.active ? "aktywny" : "nieaktywny"}</td>
                  <td className="w-44 px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => onOpenSchedule(s.id)}>
                      Grafik
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      Edytuj
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="p-3 text-sm text-muted-foreground">Brak pracowników.</p>}
        </div>
      </div>

      {editing && (
        <StaffForm
          member={editing === "new" ? null : editing}
          sites={sites}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function StaffForm({
  member,
  sites,
  onClose,
  onSaved,
}: {
  member: Staff | null;
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = member ?? EMPTY;
  const [form, setForm] = useState({
    ...start,
    title: start.title ?? "",
    phone: start.phone ?? "",
    email: start.email ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });
  const toggleSite = (id: string) =>
    set("sites", form.sites.includes(id) ? form.sites.filter((s) => s !== id) : [...form.sites, id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.sites.length) return setError("Wybierz co najmniej jedną placówkę.");
    const body: Partial<StaffInput> = {
      name: form.name.trim(),
      kind: form.kind,
      title: form.title.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      active: form.active,
      sortOrder: form.sortOrder,
      sites: form.sites,
    };
    setBusy(true);
    setError(null);
    try {
      if (member) await api.updateStaff(member.id, body);
      else await api.createStaff(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={member ? "Edytuj pracownika" : "Nowy pracownik"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="st-name">Imię i nazwisko (tak, jak w terminarzu)</Label>
          <Input id="st-name" value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="st-kind">Rodzaj</Label>
            <Select id="st-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as StaffInput["kind"])}>
              <option value="person">Osoba</option>
              <option value="calendar">Kalendarz (np. Higienizacja)</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="st-title">Stanowisko</Label>
            <Input
              id="st-title"
              placeholder="np. lekarz dentysta"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="st-phone">Telefon</Label>
            <Input id="st-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="st-email">E-mail</Label>
            <Input id="st-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Placówki</legend>
          <div className="flex gap-4 text-sm">
            {sites.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" checked={form.sites.includes(s.id)} onChange={() => toggleSite(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            Aktywny (widoczny w terminarzu)
          </label>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Kolejność kolumn
            <span className="w-16">
              <Input
                type="number"
                className="h-7"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
              />
            </span>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
