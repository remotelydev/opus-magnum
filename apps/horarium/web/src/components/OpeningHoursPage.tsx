import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type OpeningDay, type SiteOpening } from "../lib/api.ts";
import { WEEKDAY_NAMES } from "../lib/schedule.ts";
import { todayInClinic } from "../lib/time.ts";
import { DateInput, TimeInput } from "./SizedInput.tsx";

const dateFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" });
const formatDate = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00Z`));

/** Settings → opening hours of each site, plus holidays and changed days. */
export function OpeningHoursPage() {
  const [sites, setSites] = useState<SiteOpening[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .openingHours()
      .then((r) => setSites(r.sites))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-lg font-semibold">Godziny otwarcia</h1>
        <p className="text-xs text-muted-foreground">
          Godziny placówek podaje bot recepcji i strona kliniki (adres <code>/api/public/opening-hours</code>). Dni
          zamknięte w wyjątkach są pomijane przy układaniu grafiku pracy.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {sites.map((s) => (
            <SiteCard key={s.id} site={s} onChanged={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

type Row = { open: boolean; opens: string; closes: string };

function toRows(week: OpeningDay[]): Row[] {
  return WEEKDAY_NAMES.map((_, i) => {
    const d = week.find((w) => w.weekday === i + 1);
    return d ? { open: true, opens: d.opens, closes: d.closes } : { open: false, opens: "08:00", closes: "16:00" };
  });
}

function SiteCard({ site, onChanged }: { site: SiteOpening; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(site.week));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setRows(toRows(site.week));
    setDirty(false);
  }, [site.week]);

  const setRow = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
    setMessage(null);
  };

  const copyMonday = () => {
    const monday = rows[0];
    setRows(rows.map((r, i) => (i > 0 && i < 5 ? { ...monday } : r)));
    setDirty(true);
  };

  const save = async () => {
    const week = rows
      .map((r, i) => ({ ...r, weekday: i + 1 }))
      .filter((r) => r.open)
      .map(({ weekday, opens, closes }) => ({ weekday, opens, closes }));
    setBusy(true);
    try {
      await api.saveOpeningWeek(site.id, week);
      setMessage({ ok: true, text: "Zapisano." });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{site.name}</h2>
      <div className="space-y-1 p-4">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <label className="flex w-36 items-center gap-2">
              <input
                type="checkbox"
                checked={r.open}
                onChange={(e) => setRow(i, { open: e.target.checked })}
                aria-label={`${WEEKDAY_NAMES[i]} otwarte`}
              />
              <span className="capitalize">{WEEKDAY_NAMES[i]}</span>
            </label>
            {r.open ? (
              <>
                <TimeInput
                  value={r.opens}
                  onChange={(e) => setRow(i, { opens: e.target.value })}
                  aria-label={`${WEEKDAY_NAMES[i]} od`}
                  required
                />
                <span className="text-muted-foreground">–</span>
                <TimeInput
                  value={r.closes}
                  onChange={(e) => setRow(i, { closes: e.target.value })}
                  aria-label={`${WEEKDAY_NAMES[i]} do`}
                  required
                />
              </>
            ) : (
              <span className="text-xs text-muted-foreground">zamknięte</span>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-3">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Zapisywanie…" : "Zapisz godziny"}
          </Button>
          <Button size="sm" variant="ghost" onClick={copyMonday}>
            Jak poniedziałek (pn–pt)
          </Button>
          {message && (
            <span role="status" className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>
      <Exceptions site={site} onChanged={onChanged} />
    </section>
  );
}

function Exceptions({ site, onChanged }: { site: SiteOpening; onChanged: () => void }) {
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState("08:00");
  const [closes, setCloses] = useState("13:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = todayInClinic();

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setError(null);
    try {
      await api.saveOpeningException(site.id, date, {
        opens: closed ? null : opens,
        closes: closed ? null : closes,
        note: note.trim() || null,
      });
      setDate("");
      setNote("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (day: string) => {
    try {
      await api.deleteOpeningException(site.id, day);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const upcoming = site.exceptions.filter((x) => x.date >= today);

  return (
    <div className="border-t border-border p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Święta i zmienione dni</h3>
      {upcoming.length ? (
        <ul className="mb-3 divide-y divide-border text-sm">
          {upcoming.map((x) => (
            <li key={x.date} className="flex items-center gap-3 py-1.5">
              <span className="w-48">{formatDate(x.date)}</span>
              <span className={x.closed ? "text-destructive" : ""}>{x.closed ? "zamknięte" : `${x.opens}–${x.closes}`}</span>
              {x.note && <span className="truncate text-xs text-muted-foreground">{x.note}</span>}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => remove(x.date)}>
                Usuń
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">Brak. Dodaj np. Wigilię albo dzień ze skróconymi godzinami.</p>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`ex-date-${site.id}`}>Dzień</Label>
          <DateInput
            id={`ex-date-${site.id}`}
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <label className="flex h-8 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          Zamknięte
        </label>
        {!closed && (
          <>
            <TimeInput value={opens} onChange={(e) => setOpens(e.target.value)} aria-label="Od" />
            <TimeInput value={closes} onChange={(e) => setCloses(e.target.value)} aria-label="Do" />
          </>
        )}
        <div className="min-w-32 flex-1 space-y-1">
          <Label htmlFor={`ex-note-${site.id}`}>Opis</Label>
          <Input
            id={`ex-note-${site.id}`}
            className="h-8"
            placeholder="np. Wigilia"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" className="h-8">
          Dodaj
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
