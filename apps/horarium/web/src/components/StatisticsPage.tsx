import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  type CashKind,
  type FinancialReport,
  type ReturningStat,
  type Site,
  type Staff,
  type StatsRange,
  type User,
  type WorktimeStat,
} from "../lib/api.ts";
import { formatMoney } from "../lib/money.ts";
import { downloadCsv, formatDuration, percent, PRESET_LABEL, presetRange, type Preset } from "../lib/reports.ts";
import { ALL_SITES, siteColor, siteName } from "../lib/sites.ts";
import { todayInClinic } from "../lib/time.ts";

type Tab = "financial" | "employees" | "services" | "returning" | "worktime" | "cash";
const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: "financial", label: "Raport finansowy" },
  { id: "employees", label: "Aktywność pracowników" },
  { id: "services", label: "Popularność usług" },
  { id: "returning", label: "Powracalność klientów" },
  { id: "worktime", label: "Czas pracy" },
  { id: "cash", label: "Stan kasy", adminOnly: true },
];

type Csv = (string | number)[][];

/**
 * "Statystyki", as in Versum. Admins see the whole clinic; a doctor sees the same reports limited to
 * their own visits (the server does the limiting) and no cash register.
 */
export function StatisticsPage({ user, sites, staff }: { user: User; sites: Site[]; staff: Staff[] }) {
  const admin = user.role === "admin";
  const [tab, setTab] = useState<Tab>("financial");
  const [site, setSite] = useState<string>(ALL_SITES);
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(() => presetRange("month", todayInClinic()));
  const range: StatsRange = useMemo(() => {
    const r = preset === "custom" ? custom : presetRange(preset, todayInClinic());
    return { site, ...r };
  }, [site, preset, custom]);
  const [csv, setCsv] = useState<Csv | null>(null);
  const staffName = useCallback((id: number) => staff.find((s) => s.id === id)?.name ?? `#${id}`, [staff]);
  const tabs = TABS.filter((t) => admin || !t.adminOnly);
  // The register belongs to one clinic: picking it on "Wszystkie" switches to the first clinic.
  const cashSite = site === ALL_SITES ? (sites[0]?.id ?? "turek") : site;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <h1 className="mr-2 text-base font-semibold">Statystyki</h1>
        <div className="flex overflow-hidden rounded-md border border-input" role="tablist" aria-label="Placówka">
          {[...sites, ...(tab === "cash" ? [] : [{ id: ALL_SITES, name: "Wszystkie" }])].map((s) => {
            const on = s.id === (tab === "cash" ? cashSite : site);
            const color = s.id === ALL_SITES ? null : siteColor(s.id);
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setSite(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs pointer-coarse:py-2 ${on ? (color ? "text-white" : "bg-primary text-primary-foreground") : "bg-surface hover:bg-muted"}`}
                style={on && color ? { background: color } : undefined}
              >
                {color && !on && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />}
                {s.name}
              </button>
            );
          })}
        </div>
        <select
          aria-label="Okres"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
        >
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABEL[p]}
            </option>
          ))}
        </select>
        {preset === "custom" ? (
          <span className="flex items-center gap-1 text-xs">
            <input type="date" aria-label="Od" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-8 rounded-md border border-input bg-surface px-2" />
            –
            <input type="date" aria-label="Do" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-8 rounded-md border border-input bg-surface px-2" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {range.from === range.to ? range.from : `${range.from} – ${range.to}`}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!csv}
          onClick={() => csv && downloadCsv(`${tab}-${range.site === ALL_SITES && tab !== "cash" ? "wszystkie" : tab === "cash" ? cashSite : range.site}-${range.from}-${range.to}`, csv)}
        >
          Pobierz do Excela
        </Button>
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface px-3 sm:px-4" aria-label="Raporty">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="p-3 sm:p-4">
        {tab === "financial" && <Financial range={range} sites={sites} staffName={staffName} onCsv={setCsv} />}
        {tab === "employees" && <Employees range={range} sites={sites} staffName={staffName} onCsv={setCsv} />}
        {tab === "services" && <Services range={range} staffName={staffName} onCsv={setCsv} />}
        {tab === "returning" && <Returning range={range} staffName={staffName} onCsv={setCsv} />}
        {tab === "worktime" && <Worktime range={range} staffName={staffName} onCsv={setCsv} />}
        {tab === "cash" && admin && <Cash range={{ ...range, site: cashSite }} siteLabel={siteName(sites, cashSite)} onCsv={setCsv} />}
      </div>
    </div>
  );
}

/** Loads a report whenever the range changes. */
function useReport<T>(load: (r: StatsRange) => Promise<T>, range: StatsRange) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load(range)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.site, range.from, range.to, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

function State({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (loading) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  return null;
}

function Table({ head, rows, foot, align }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; align?: ("l" | "r")[] }) {
  const cls = (i: number) => (align?.[i] === "l" || (!align && i === 0) ? "text-left" : "text-right tabular-nums");
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-2 font-medium ${cls(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-4 text-center text-muted-foreground">
                Brak danych w tym okresie.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) => (
                <td key={i} className={`px-3 py-2 ${cls(i)}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && rows.length > 0 && (
          <tfoot className="border-t border-border font-medium">
            <tr>
              {foot.map((c, i) => (
                <td key={i} className={`px-3 py-2 ${cls(i)}`}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Per person, or per person and clinic when "Wszystkie" is on and the split is ticked. */
function useStaffRows(report: FinancialReport | null, split: boolean) {
  return useMemo(() => {
    if (!report) return [];
    const map = new Map<string, { staffId: number; siteId: string | null; visits: number; minutes: number; revenue: number }>();
    for (const r of report.staff) {
      const key = split ? `${r.staffId}:${r.siteId}` : String(r.staffId);
      const row = map.get(key) ?? { staffId: r.staffId, siteId: split ? r.siteId : null, visits: 0, minutes: 0, revenue: 0 };
      row.visits += r.visits;
      row.minutes += r.minutes;
      row.revenue += r.revenue;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.visits - a.visits);
  }, [report, split]);
}

function SplitToggle({ range, split, onSplit }: { range: StatsRange; split: boolean; onSplit: (v: boolean) => void }) {
  if (range.site !== ALL_SITES) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={split} onChange={(e) => onSplit(e.target.checked)} />
      Osobno dla każdej placówki
    </label>
  );
}

interface ReportProps {
  range: StatsRange;
  staffName: (id: number) => string;
  onCsv: (csv: Csv | null) => void;
}

function Financial({ range, sites, staffName, onCsv }: ReportProps & { sites: Site[] }) {
  const { data, error } = useReport(api.financial, range);
  const [split, setSplit] = useState(false);
  const rows = useStaffRows(data, split && range.site === ALL_SITES);
  const name = (r: { staffId: number; siteId: string | null }) => (r.siteId ? `${staffName(r.staffId)} (${siteName(sites, r.siteId)})` : staffName(r.staffId));
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([
      ["Pracownik", "Wizyty", "Łączny czas wizyt (min)", "Utarg (zł)", "Udział"],
      ...rows.map((r) => [name(r), r.visits, r.minutes, r.revenue, percent(r.revenue, data.totals.revenue)]),
      ["Łącznie", data.totals.visits, data.totals.minutes, data.totals.revenue, "100%"],
      [],
      ["Forma płatności", "Kwota (zł)", "Udział"],
      ...data.methods.map((m) => [m.label, m.amount, percent(m.amount, data.totals.revenue)]),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rows]);
  if (!data) return <State error={error} loading />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Sfinalizowane wizyty" value={data.totals.visits} />
        <Tile label="Łączny czas wizyt" value={formatDuration(data.totals.minutes)} />
        <Tile label="Utarg" value={formatMoney(data.totals.revenue)} />
        <Tile label="Średnio na wizytę" value={data.totals.visits ? formatMoney(data.totals.revenue / data.totals.visits) : "—"} />
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Udział form płatności w utargu</h2>
        {data.methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak płatności w tym okresie.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.methods.map((m) => (
              <li key={m.method} className="text-sm">
                <div className="flex justify-between">
                  <span>{m.label}</span>
                  <span className="tabular-nums">
                    {formatMoney(m.amount)} ({percent(m.amount, data.totals.revenue)})
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted">
                  <div className="h-full rounded bg-primary" style={{ width: `${data.totals.revenue ? (m.amount / data.totals.revenue) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Dane w podziale na pracowników</h2>
          <SplitToggle range={range} split={split} onSplit={setSplit} />
        </div>
        <Table
          head={["Pracownik", "Wizyty", "Łączny czas wizyt", "Utarg", "Udział"]}
          rows={rows.map((r) => [name(r), r.visits, formatDuration(r.minutes), formatMoney(r.revenue), percent(r.revenue, data.totals.revenue)])}
          foot={["Łącznie", data.totals.visits, formatDuration(data.totals.minutes), formatMoney(data.totals.revenue), "100%"]}
        />
      </section>
    </div>
  );
}

function Employees({ range, sites, staffName, onCsv }: ReportProps & { sites: Site[] }) {
  const { data, error } = useReport(api.financial, range);
  const [split, setSplit] = useState(false);
  const staffRows = useStaffRows(data, split && range.site === ALL_SITES);
  const rows = useMemo(() => [...staffRows].sort((a, b) => b.minutes - a.minutes), [staffRows]);
  const name = (r: { staffId: number; siteId: string | null }) => (r.siteId ? `${staffName(r.staffId)} (${siteName(sites, r.siteId)})` : staffName(r.staffId));
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([["Pracownik", "Czas wizyt (min)", "Liczba wizyt"], ...rows.map((r) => [name(r), r.minutes, r.visits]), ["Łącznie", data.totals.minutes, data.totals.visits]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rows.length, split]);
  if (!data) return <State error={error} loading />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <SplitToggle range={range} split={split} onSplit={setSplit} />
      </div>
      <Table
        head={["Pracownik", "Czas wizyt", "Liczba wizyt", ""]}
        rows={rows.map((r) => [
          name(r),
          formatDuration(r.minutes),
          r.visits,
          <div key="bar" className="ml-auto h-2 w-32 rounded bg-muted" aria-hidden="true">
            <div className="h-full rounded bg-primary" style={{ width: `${(r.minutes / max) * 100}%` }} />
          </div>,
        ])}
        foot={["Łącznie", formatDuration(data.totals.minutes), data.totals.visits, ""]}
      />
      <p className="text-xs text-muted-foreground">Czas i liczba sfinalizowanych wizyt pacjentów.</p>
    </div>
  );
}

function Services({ range, staffName, onCsv }: ReportProps) {
  const { data, error } = useReport(api.serviceStats, range);
  const [view, setView] = useState<"service" | "staff">("service");
  const rows = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { key: string; label: string; category: string; done: number; paid: number; doneMin: number; waiting: number; value: number; waitMin: number }>();
    for (const r of data) {
      const key = view === "service" ? `${r.serviceId ?? r.name}` : `${r.staffId}|${r.serviceId ?? r.name}`;
      const row = map.get(key) ?? {
        key,
        label: view === "service" ? r.name : `${staffName(r.staffId)} · ${r.name}`,
        category: r.category ?? "—",
        done: 0,
        paid: 0,
        doneMin: 0,
        waiting: 0,
        value: 0,
        waitMin: 0,
      };
      if (r.done) {
        row.done += r.count;
        row.paid += r.amount;
        row.doneMin += r.minutes;
      } else {
        row.waiting += r.count;
        row.value += r.amount;
        row.waitMin += r.minutes;
      }
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.paid - a.paid || b.done - a.done);
  }, [data, view, staffName]);
  const total = rows.reduce((t, r) => ({ done: t.done + r.done, paid: t.paid + r.paid, doneMin: t.doneMin + r.doneMin, waiting: t.waiting + r.waiting, value: t.value + r.value, waitMin: t.waitMin + r.waitMin }), { done: 0, paid: 0, doneMin: 0, waiting: 0, value: 0, waitMin: 0 });
  const head = [view === "service" ? "Usługa" : "Pracownik · usługa", "Kategoria", "Udział w obrocie", "Zapłacono", "Czas", "Wykonania", "Oczekujące: wartość", "Czas", "Liczba"];
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([
      head,
      ...rows.map((r) => [r.label, r.category, percent(r.paid, total.paid), r.paid, r.doneMin, r.done, r.value, r.waitMin, r.waiting]),
      ["Łącznie", "", "100%", total.paid, total.doneMin, total.done, total.value, total.waitMin, total.waiting],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rows]);
  if (!data) return <State error={error} loading />;
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Button size="sm" variant={view === "service" ? "primary" : "outline"} onClick={() => setView("service")}>
          Wg usług
        </Button>
        <Button size="sm" variant={view === "staff" ? "primary" : "outline"} onClick={() => setView("staff")}>
          Wg pracowników
        </Button>
      </div>
      <Table
        head={head}
        align={["l", "l", "r", "r", "r", "r", "r", "r", "r"]}
        rows={rows.map((r) => [r.label, r.category, percent(r.paid, total.paid), formatMoney(r.paid), formatDuration(r.doneMin), r.done, formatMoney(r.value), formatDuration(r.waitMin), r.waiting])}
        foot={["Łącznie", "", "100%", formatMoney(total.paid), formatDuration(total.doneMin), total.done, formatMoney(total.value), formatDuration(total.waitMin), total.waiting]}
      />
      <p className="text-xs text-muted-foreground">
        Sfinalizowane: usługi wpisane przy zakończeniu wizyty. Wizyty z Versum mają wpisaną tylko kwotę, więc liczą się jako „Usługa spoza
        cennika”. Oczekujące: umówione wizyty w tym okresie, wycenione według cennika.
      </p>
    </div>
  );
}

function Returning({ range, staffName, onCsv }: ReportProps) {
  const { data, error } = useReport(api.returning, range);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.backToClinic / (b.new || 1) - a.backToClinic / (a.new || 1) || b.served - a.served), [data]);
  const total = rows.reduce((t, r) => ({ served: t.served + r.served, new: t.new + r.new, backToClinic: t.backToClinic + r.backToClinic, backToStaff: t.backToStaff + r.backToStaff }), { served: 0, new: 0, backToClinic: 0, backToStaff: 0 });
  const fmt = (n: number, of: number) => `${n} (${percent(n, of)})`;
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([
      ["Pracownik", "Obsłużeni klienci", "Nowi klienci", "Powracający do placówki", "Powracający do pracownika"],
      ...rows.map((r: ReturningStat) => [staffName(r.staffId), r.served, r.new, r.backToClinic, r.backToStaff]),
      ["Podsumowanie", total.served, total.new, total.backToClinic, total.backToStaff],
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (!data) return <State error={error} loading />;
  return (
    <div className="space-y-2">
      <Table
        head={["Pracownik", "Obsłużeni klienci", "Nowi klienci", "Powracający do placówki", "Powracający do pracownika"]}
        rows={rows.map((r) => [staffName(r.staffId), r.served, r.new, fmt(r.backToClinic, r.new), fmt(r.backToStaff, r.new)])}
        foot={["Podsumowanie", total.served, total.new, fmt(total.backToClinic, total.new), fmt(total.backToStaff, total.new)]}
      />
      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div><dt className="inline font-medium">Obsłużeni:</dt> <dd className="inline">różni pacjenci przyjęci w tym okresie (każdy liczony raz).</dd></div>
        <div><dt className="inline font-medium">Nowi:</dt> <dd className="inline">pacjenci, których pierwsza wizyta w ogóle była w tym okresie u tej osoby.</dd></div>
        <div><dt className="inline font-medium">Powracający do placówki:</dt> <dd className="inline">nowi, którzy przyszli później na kolejną wizytę (do kogokolwiek).</dd></div>
        <div><dt className="inline font-medium">Powracający do pracownika:</dt> <dd className="inline">nowi, którzy wrócili do tej samej osoby.</dd></div>
      </dl>
    </div>
  );
}

function Worktime({ range, staffName, onCsv }: ReportProps) {
  const { data, error } = useReport(api.worktime, range);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.workMinutes - a.workMinutes), [data]);
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([
      ["Pracownik", "Godziny w grafiku (min)", "Dni pracy", "Dni nieobecności", "Czas wizyt (min)"],
      ...rows.map((r: WorktimeStat) => [staffName(r.staffId), r.workMinutes, r.workDays, r.absenceDays, r.visitMinutes]),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (!data) return <State error={error} loading />;
  const sum = (k: keyof WorktimeStat) => rows.reduce((n, r) => n + r[k], 0);
  return (
    <div className="space-y-2">
      <Table
        head={["Pracownik", "Godziny w grafiku", "Dni pracy", "Dni nieobecności", "Czas wizyt"]}
        rows={rows.map((r) => [staffName(r.staffId), formatDuration(r.workMinutes), r.workDays, r.absenceDays, formatDuration(r.visitMinutes)])}
        foot={["Łącznie", formatDuration(sum("workMinutes")), sum("workDays"), sum("absenceDays"), formatDuration(sum("visitMinutes"))]}
      />
      <p className="text-xs text-muted-foreground">Z grafiku pracy. Nieobecności nie mają jeszcze rodzaju (urlop, choroba, szkolenie), więc liczą się razem.</p>
    </div>
  );
}

const CASH_LABEL: Record<CashKind, string> = { in: "Wpływ", out: "Wypływ", open: "Otwarcie kasy", close: "Zamknięcie kasy" };

function Cash({ range, siteLabel, onCsv }: Omit<ReportProps, "staffName"> & { siteLabel: string }) {
  const { data, error, reload } = useReport(api.cash, range);
  const [adding, setAdding] = useState<CashKind | null>(null);
  const time = (iso: string) => new Date(iso).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" });
  useEffect(() => {
    if (!data) return onCsv(null);
    onCsv([
      ["Data", "Typ", "Dotyczy", "Kwota (zł)", "Pacjent", "Pracownik / kto"],
      ...[
        ...data.visits.map((v) => ({ at: v.at, row: [time(v.at), "Wizyta", v.what, v.amount, v.patientName ?? "", v.staffName ?? ""] })),
        ...data.operations.map((o) => ({ at: o.at, row: [time(o.at), CASH_LABEL[o.kind], o.note ?? "", o.kind === "out" ? -o.amount : o.amount, "", o.userName ?? ""] })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((x) => x.row),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (!data) return <State error={error} loading />;
  const all = [
    ...data.visits.map((v) => ({ key: `v${v.id}`, at: v.at, kind: "Wizyta", what: v.what, amount: v.amount, patient: v.patientName, who: v.staffName })),
    ...data.operations.map((o) => ({ key: `o${o.id}`, at: o.at, kind: CASH_LABEL[o.kind], what: o.note, amount: o.kind === "out" ? -o.amount : o.amount, patient: null, who: o.userName, counted: o.kind === "open" || o.kind === "close" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <Tile label={`Stan kasy · ${siteLabel}`} value={formatMoney(data.balance)} />
        <div className="text-sm text-muted-foreground">
          {data.counted ? (
            <>
              Kasa {data.open ? "otwarta" : "zamknięta"}: {formatMoney(data.counted.amount)}, {time(data.counted.at)}
              {data.counted.userName ? ` · ${data.counted.userName}` : ""}
            </>
          ) : (
            "Kasy jeszcze nie przeliczono: stan to cała gotówka z wizyt."
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding("in")}>Dodaj wpływ</Button>
          <Button size="sm" variant="outline" onClick={() => setAdding("out")}>Dodaj wypływ</Button>
          <Button size="sm" onClick={() => setAdding(data.open ? "close" : "open")}>{data.open ? "Zamknij kasę" : "Otwórz kasę"}</Button>
        </div>
      </div>
      <Table
        head={["Data", "Typ", "Dotyczy", "Kwota (gotówka)", "Pacjent", "Pracownik"]}
        align={["l", "l", "l", "r", "l", "l"]}
        rows={all.map((r) => [time(r.at), r.kind, r.what ?? "", "counted" in r && r.counted ? `stan: ${formatMoney(r.amount)}` : formatMoney(r.amount), r.patient ?? "", r.who ?? ""])}
      />
      {adding && (
        <CashDialog
          kind={adding}
          siteId={range.site}
          siteLabel={siteLabel}
          balance={data.balance}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CashDialog({ kind, siteId, siteLabel, balance, onClose, onSaved }: { kind: CashKind; siteId: string; siteLabel: string; balance: number; onClose: () => void; onSaved: () => void }) {
  const counting = kind === "open" || kind === "close";
  const [amount, setAmount] = useState(counting ? String(balance).replace(".", ",") : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || amount.trim() === "") return setError("Podaj kwotę.");
    setBusy(true);
    try {
      await api.addCash({ siteId, kind, amount: n, note: note.trim() || null });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`${CASH_LABEL[kind]} · ${siteLabel}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <Label htmlFor="cash-amount">{counting ? "Przeliczony stan kasy (zł)" : "Kwota (zł)"}</Label>
          <Input id="cash-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          {counting && <p className="text-xs text-muted-foreground">Wyliczony stan: {formatMoney(balance)}.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cash-note">Opis</Label>
          <Input id="cash-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "out" ? "np. zakupy, wpłata do banku" : ""} />
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={save}>Zapisz</Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>Anuluj</Button>
        </div>
      </div>
    </Modal>
  );
}

