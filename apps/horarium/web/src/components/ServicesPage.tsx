import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Service, type ServiceInput } from "../lib/api.ts";

const EMPTY: ServiceInput = {
  category: "",
  name: "",
  description: null,
  durationMinutes: 30,
  priceMin: null,
  priceMax: null,
  priceNote: null,
  showOnline: true,
  sortOrder: 0,
  active: true,
};

export function formatPrice(s: Pick<Service, "priceMin" | "priceMax" | "priceNote">): string {
  const zl = (n: number) => `${n.toLocaleString("pl-PL")} zł`;
  let text = "";
  if (s.priceMin != null && s.priceMax != null && s.priceMax !== s.priceMin) text = `${zl(s.priceMin)}–${zl(s.priceMax)}`;
  else if (s.priceMin != null) text = zl(s.priceMin);
  else if (s.priceMax != null) text = `do ${zl(s.priceMax)}`;
  else text = "—";
  return s.priceNote ? `${text} ${s.priceNote}` : text;
}

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .allServices()
      .then(setServices)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, Service[]>();
    for (const s of services) {
      if (!showInactive && !s.active) continue;
      if (q && !`${s.category} ${s.name}`.toLowerCase().includes(q)) continue;
      map.set(s.category, [...(map.get(s.category) ?? []), s]);
    }
    return [...map.entries()];
  }, [services, filter, showInactive]);

  const categories = useMemo(() => [...new Set(services.map((s) => s.category))].sort(), [services]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Usługi i cennik</h1>
          <div className="w-full sm:w-60">
            <Input
              className="h-8"
              placeholder="Szukaj usługi"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Szukaj usługi"
            />
          </div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Pokaż wyłączone
          </label>
          <Button className="ml-auto" size="sm" onClick={() => setEditing("new")}>
            + Dodaj usługę
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ta lista zasila terminarz, bota i cennik na stronie kliniki. Usługi bez „Na stronie” widzi tylko recepcja.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {groups.map(([category, list]) => (
          <section key={category} className="overflow-hidden rounded-lg border border-border bg-surface">
            <h2 className="border-b border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Usługa</th>
                  <th>Czas</th>
                  <th>Cena</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={`border-b border-border last:border-0 ${s.active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.name}</div>
                      {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                      {/* Phones: time, price and status folded under the name. */}
                      <div className="text-xs text-muted-foreground sm:hidden">
                        {s.durationMinutes} min · <span className="text-foreground">{formatPrice(s)}</span>
                        {" · "}
                        {!s.active ? "wyłączona" : s.showOnline ? "na stronie" : "tylko recepcja"}
                      </div>
                    </td>
                    <td className="hidden w-20 px-3 py-2 text-muted-foreground sm:table-cell">{s.durationMinutes} min</td>
                    <td className="hidden w-48 px-3 py-2 sm:table-cell">{formatPrice(s)}</td>
                    <td className="hidden w-36 px-3 py-2 text-xs text-muted-foreground md:table-cell">
                      {!s.active ? "wyłączona" : s.showOnline ? "na stronie" : "tylko recepcja"}
                    </td>
                    <td className="w-20 px-2 py-2 text-right sm:px-3">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Edytuj
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {!groups.length && <p className="text-sm text-muted-foreground">Brak usług.</p>}
      </div>

      {editing && (
        <ServiceForm
          service={editing === "new" ? null : editing}
          categories={categories}
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

function numberOrNull(text: string): number | null {
  const t = text.replace(",", ".").trim();
  return t === "" ? null : Number(t);
}

function ServiceForm({
  service,
  categories,
  onClose,
  onSaved,
}: {
  service: Service | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = service ?? EMPTY;
  const [form, setForm] = useState({
    ...start,
    priceMin: start.priceMin?.toString() ?? "",
    priceMax: start.priceMax?.toString() ?? "",
    description: start.description ?? "",
    priceNote: start.priceNote ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const priceMin = numberOrNull(form.priceMin);
    const priceMax = numberOrNull(form.priceMax);
    if ((priceMin !== null && Number.isNaN(priceMin)) || (priceMax !== null && Number.isNaN(priceMax))) {
      return setError("Cena musi być liczbą.");
    }
    const body: Partial<ServiceInput> = {
      category: form.category.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      durationMinutes: form.durationMinutes,
      priceMin,
      priceMax: priceMax ?? priceMin,
      priceNote: form.priceNote.trim() || null,
      showOnline: form.showOnline,
      sortOrder: form.sortOrder,
      active: form.active,
    };
    setBusy(true);
    setError(null);
    try {
      if (service) await api.updateService(service.id, body);
      else await api.createService(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={service ? "Edytuj usługę" : "Nowa usługa"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-[1fr_6rem] gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="s-cat">Kategoria</Label>
            <Input id="s-cat" list="s-cats" value={form.category} onChange={(e) => set("category", e.target.value)} required />
            <datalist id="s-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-dur">Czas (min)</Label>
            <Input
              id="s-dur"
              type="number"
              min={5}
              max={480}
              step={5}
              value={form.durationMinutes}
              onChange={(e) => set("durationMinutes", Number(e.target.value))}
              required
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-name">Nazwa</Label>
          <Input id="s-name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="s-desc">Opis na stronę (opcjonalnie)</Label>
          <Input id="s-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="s-pmin">Cena od (zł)</Label>
            <Input id="s-pmin" inputMode="decimal" value={form.priceMin} onChange={(e) => set("priceMin", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-pmax">Cena do (zł)</Label>
            <Input
              id="s-pmax"
              inputMode="decimal"
              placeholder="jak „od”"
              value={form.priceMax}
              onChange={(e) => set("priceMax", e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-1">
            <Label htmlFor="s-pnote">Dopisek</Label>
            <Input id="s-pnote" placeholder="np. za ząb" value={form.priceNote} onChange={(e) => set("priceNote", e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.showOnline} onChange={(e) => set("showOnline", e.target.checked)} />
            Na stronie kliniki
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            Aktywna
          </label>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Kolejność
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
