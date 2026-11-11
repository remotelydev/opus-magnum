import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label, Select } from "@opus-magnum/dentaplus-ui/components/field";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type PatternDay, type ScheduleBlock, type Site, type Staff } from "../lib/api.ts";
import { endOfMonthAfter, mondayOf, WEEKDAY_NAMES, weeklyHours } from "../lib/schedule.ts";
import { addDays, formatMinutes, fromClinicTime, toClinicTime, todayInClinic } from "../lib/time.ts";
import { DateInput, TimeInput } from "./SizedInput.tsx";

const shortDate = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", day: "numeric", month: "short" });
const fmt = (date: string) => shortDate.format(new Date(`${date}T12:00:00Z`));

/**
 * Settings → work schedule. Set a person's weekly pattern, lay it out over a date range
 * (writes the working hours the calendar shows), check the weeks and add absences.
 */
export function SchedulePage({ initialStaffId }: { initialStaffId?: number | null }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [staffId, setStaffId] = useState<number | null>(initialStaffId ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.staff(), api.sites()])
      .then(([st, si]) => {
        const active = st.filter((s) => s.active);
        setStaff(active);
        setSites(si);
        setStaffId((id) => id ?? active[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const member = staff.find((s) => s.id === staffId) ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Grafik pracy</h1>
          <div className="w-72">
            <Select
              className="h-8"
              value={staffId ?? ""}
              onChange={(e) => setStaffId(Number(e.target.value))}
              aria-label="Pracownik"
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {member && <StaffSchedule key={member.id} member={member} sites={sites} />}
        {!member && !error && <p className="text-sm text-muted-foreground">Brak aktywnych pracowników.</p>}
      </div>
    </div>
  );
}

function StaffSchedule({ member, sites }: { member: Staff; sites: Site[] }) {
  const [reloadKey, setReloadKey] = useState(0);
  const memberSites = sites.filter((s) => member.sites.includes(s.id));
  return (
    <>
      <PatternEditor member={member} sites={memberSites} onGenerated={() => setReloadKey((k) => k + 1)} />
      <WeekView member={member} sites={sites} reloadKey={reloadKey} onChanged={() => setReloadKey((k) => k + 1)} />
    </>
  );
}

function PatternEditor({ member, sites, onGenerated }: { member: Staff; sites: Site[]; onGenerated: () => void }) {
  const today = todayInClinic();
  const [days, setDays] = useState<PatternDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(endOfMonthAfter(today, 3));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const defaultSite = sites[0]?.id ?? "";

  useEffect(() => {
    api
      .workPattern(member.id)
      .then((d) => {
        setDays(d);
        setLoaded(true);
      })
      .catch((e: Error) => setMessage({ ok: false, text: e.message }));
  }, [member.id]);

  const change = (next: PatternDay[]) => {
    setDays(next);
    setDirty(true);
    setMessage(null);
  };
  const update = (index: number, patch: Partial<PatternDay>) => change(days.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const remove = (index: number) => change(days.filter((_, i) => i !== index));
  const add = (weekday: number) => {
    const last = days.filter((d) => d.weekday === weekday).at(-1);
    const range = last ? { starts: last.ends, ends: last.ends < "20:00" ? "20:00" : "23:00" } : { starts: "08:00", ends: "16:00" };
    change([...days, { weekday, siteId: last?.siteId ?? defaultSite, ...range }]);
  };
  const copyMonday = () => {
    const monday = days.filter((d) => d.weekday === 1);
    change([...days.filter((d) => d.weekday === 1 || d.weekday > 5), ...[2, 3, 4, 5].flatMap((weekday) => monday.map((d) => ({ ...d, weekday })))]);
  };

  const savePattern = async () => {
    await api.saveWorkPattern(member.id, days);
    setDirty(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      await savePattern();
      setMessage({ ok: true, text: "Zapisano tygodniowy grafik." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (
      !window.confirm(
        `Ułożyć grafik ${member.name} od ${fmt(from)} do ${fmt(to)}?\nGodziny pracy w tym okresie zostaną zastąpione. Nieobecności zostają.`,
      )
    )
      return;
    setBusy(true);
    try {
      if (dirty) await savePattern();
      const r = await api.generateSchedule(member.id, from, to);
      const skipped = r.skippedClosed ? ` Pominięto ${r.skippedClosed} (placówka zamknięta).` : "";
      setMessage({ ok: true, text: `Gotowe: ${r.created} bloków pracy w grafiku.${skipped}` });
      onGenerated();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const hours = useMemo(() => weeklyHours(days), [days]);

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Tygodniowy grafik</h2>
        <span className="text-xs text-muted-foreground">
          {hours.toLocaleString("pl-PL")} h tygodniowo{member.title ? ` · ${member.title}` : ""}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={copyMonday} disabled={!days.some((d) => d.weekday === 1)}>
          Jak poniedziałek (pn–pt)
        </Button>
      </div>
      <div className="divide-y divide-border">
        {WEEKDAY_NAMES.map((name, i) => {
          const weekday = i + 1;
          const ranges = days.map((d, index) => ({ d, index })).filter(({ d }) => d.weekday === weekday);
          return (
            <div key={name} className="flex items-start gap-3 px-4 py-2 text-sm">
              <div className="w-28 pt-1.5 capitalize">{name}</div>
              <div className="flex flex-1 flex-col gap-1.5">
                {!ranges.length && <span className="pt-1.5 text-xs text-muted-foreground">wolne</span>}
                {ranges.map(({ d, index }) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    {sites.length > 1 ? (
                      <Select
                        className="h-8 w-36"
                        value={d.siteId}
                        onChange={(e) => update(index, { siteId: e.target.value })}
                        aria-label={`${name}: placówka`}
                      >
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="w-36 text-muted-foreground">{siteName(d.siteId)}</span>
                    )}
                    <TimeInput
                      value={d.starts}
                      onChange={(e) => update(index, { starts: e.target.value })}
                      aria-label={`${name}: od`}
                    />
                    <span className="text-muted-foreground">–</span>
                    <TimeInput
                      value={d.ends}
                      onChange={(e) => update(index, { ends: e.target.value })}
                      aria-label={`${name}: do`}
                    />
                    <Button variant="ghost" size="sm" onClick={() => remove(index)} aria-label={`${name}: usuń godziny`}>
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => add(weekday)} disabled={!loaded || !sites.length}>
                + godziny
              </Button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-border px-4 py-3">
        <Button size="sm" variant="outline" onClick={save} disabled={busy || !dirty}>
          Zapisz tydzień
        </Button>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="gen-from">Ułóż od</Label>
            <DateInput id="gen-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gen-to">do</Label>
            <DateInput id="gen-to" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button size="sm" className="h-8" onClick={generate} disabled={busy || !from || !to || !loaded}>
            {busy ? "Układanie…" : "Ułóż grafik"}
          </Button>
        </div>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        „Ułóż grafik” wpisuje ten tydzień w każdy tydzień wybranego okresu i zastępuje godziny pracy, które już tam są.
        Nieobecności zostają, a dni zamknięte w godzinach otwarcia (np. święta) są pomijane.
      </p>
      {message && (
        <p role="status" className={`px-4 pb-3 text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function WeekView({
  member,
  sites,
  reloadKey,
  onChanged,
}: {
  member: Staff;
  sites: Site[];
  reloadKey: number;
  onChanged: () => void;
}) {
  const today = todayInClinic();
  const [monday, setMonday] = useState(mondayOf(today));
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [absenceFrom, setAbsenceFrom] = useState("");
  const [absenceTo, setAbsenceTo] = useState("");
  const sunday = addDays(monday, 6);

  const load = useCallback(() => {
    api
      .staffSchedules(member.id, monday, sunday)
      .then((b) => {
        setBlocks(b);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [member.id, monday, sunday]);
  useEffect(load, [load, reloadKey]);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const remove = async (b: ScheduleBlock) => {
    const what = b.kind === "absence" ? "tę nieobecność" : "ten blok pracy";
    if (!window.confirm(`Usunąć ${what}?`)) return;
    try {
      await api.deleteSchedule(b.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addAbsence = async () => {
    if (!absenceFrom) return;
    const last = absenceTo && absenceTo >= absenceFrom ? absenceTo : absenceFrom;
    try {
      await api.createSchedule({
        staffId: member.id,
        siteId: member.sites[0] ?? sites[0]?.id ?? "",
        startsAt: fromClinicTime(absenceFrom, 0).toISOString(),
        endsAt: fromClinicTime(addDays(last, 1), 0).toISOString(),
        kind: "absence",
      });
      setAbsenceFrom("");
      setAbsenceTo("");
      setMonday(mondayOf(absenceFrom));
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          Tydzień {fmt(monday)} – {fmt(sunday)}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Poprzedni tydzień" onClick={() => setMonday(addDays(monday, -7))}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonday(mondayOf(today))}>
            Ten tydzień
          </Button>
          <Button variant="outline" size="icon" aria-label="Następny tydzień" onClick={() => setMonday(addDays(monday, 7))}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
      {error && <p className="px-4 pt-2 text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-7 sm:divide-x sm:divide-y-0">
        {week.map((date, i) => {
          const dayStart = fromClinicTime(date, 0).getTime();
          const dayEnd = fromClinicTime(addDays(date, 1), 0).getTime();
          const items = blocks.filter((b) => new Date(b.startsAt).getTime() < dayEnd && new Date(b.endsAt).getTime() > dayStart);
          return (
            <div key={date} className={`min-h-28 p-2 ${date === today ? "bg-primary-soft/40" : ""}`}>
              <div className="mb-1.5 text-xs text-muted-foreground">
                <span className="capitalize">{WEEKDAY_NAMES[i].slice(0, 3)}</span> {fmt(date)}
              </div>
              <div className="space-y-1">
                {items.map((b) => (
                  <div
                    key={b.id}
                    className={`group relative rounded px-1.5 py-1 text-[11px] leading-tight ${
                      b.kind === "absence"
                        ? "bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,var(--dp-muted)_4px,var(--dp-muted)_8px)] text-muted-foreground"
                        : "bg-calendar-on text-foreground"
                    }`}
                  >
                    {b.kind === "absence" ? (
                      <span className="font-medium">Nieobecność</span>
                    ) : (
                      <>
                        <span className="font-medium">
                          {formatMinutes(toClinicTime(b.startsAt).minutes)}–{formatMinutes(toClinicTime(b.endsAt).minutes)}
                        </span>
                        <span className="block opacity-80">{siteName(b.siteId)}</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(b)}
                      className="absolute top-0.5 right-1 hidden text-muted-foreground group-hover:block hover:text-destructive"
                      aria-label="Usuń"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {!items.length && <span className="text-[11px] text-muted-foreground">—</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
        <span className="pb-1.5 text-sm font-medium">Nieobecność</span>
        <div className="space-y-1">
          <Label htmlFor="abs-from">od</Label>
          <DateInput id="abs-from" value={absenceFrom} onChange={(e) => setAbsenceFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="abs-to">do (włącznie)</Label>
          <DateInput
            id="abs-to"
            min={absenceFrom}
            value={absenceTo}
            onChange={(e) => setAbsenceTo(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={addAbsence} disabled={!absenceFrom}>
          Dodaj nieobecność
        </Button>
        <span className="pb-1.5 text-xs text-muted-foreground">Urlop lub choroba na całe dni. Terminarz ostrzeże przy zapisie.</span>
      </div>
    </section>
  );
}
