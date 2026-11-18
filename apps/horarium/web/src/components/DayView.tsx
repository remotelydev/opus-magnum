import { STATUS_CLASSES } from "@opus-magnum/dentaplus-ui/components/status";
import { calendar } from "@opus-magnum/dentaplus-ui/tokens";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api, type Appointment, type ScheduleBlock, type Service, type Site, type Staff } from "../lib/api.ts";
import { staffColor } from "../lib/columns.ts";
import { ALL_SITES, siteColor, siteName, type AllVariant, type CalendarColumn } from "../lib/sites.ts";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  SLOT_MIN,
  formatMinutes,
  slotAt,
  fromClinicTime,
  layoutColumn,
  toClinicTime,
} from "../lib/time.ts";
import { AppointmentPanel } from "./AppointmentPanel.tsx";
import { BookingDialog } from "./BookingDialog.tsx";
import { MoveDialog } from "./MoveDialog.tsx";

const PX_PER_MIN = calendar.pxPerMinute;
/** Every column gets an equal share; the rows are at least 9rem (8rem on desktops) per doctor wide,
 *  so two doctors fit a phone and about a dozen fit a 24-inch screen. Header and body use the same
 *  rule, so the names always sit above their columns. */
const COLUMN = "min-w-0 flex-1 basis-0";
const ROW = "flex min-w-[calc(3.5rem+var(--cols)*9rem)] lg:min-w-[calc(3.5rem+var(--cols)*8rem)]";
const HOURS = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 }, (_, i) => DAY_START_MIN + i * 60);


interface Props {
  /** A site id, or ALL_SITES for both clinics on one calendar. */
  site: string;
  sites: Site[];
  /** How "Wszystkie" tells the clinics apart; ignored for a single site. */
  variant?: AllVariant;
  date: string;
  /** Everyone at the site: the booking and visit dialogs can pick any of them. */
  staff: Staff[];
  /** The people ticked in the staff panel, one column each (one per clinic in the "columns" variant). */
  columns: CalendarColumn[];
  /** The day's data, loaded once for the calendar and the staff panel (see useDayData). */
  appointments: Appointment[];
  schedules: ScheduleBlock[];
  error: string | null;
  reload: () => void;
  services: Service[];
  canEdit: boolean;
  /** Admins see each patient's change log in the visit panel. */
  canSeeHistory?: boolean;
  /** Doctors and admins write the treatment description in the visit panel. */
  canDescribe?: boolean;
  /** "Pokaż odwołane" in the header: cancelled and no-show visits stay on the calendar. */
  showCancelled?: boolean;
  /** Visit to open on arrival, e.g. after "Pokaż w terminarzu" in the patient card. */
  initialSelected?: number | null;
  onOpenPatient?: (patientId: number) => void;
  onOpenVisit?: (siteId: string, date: string, appointmentId: number) => void;
}

type Booking = { staffId: number; startMin: number; siteId: string | null };
type Hover = { key: string; startMin: number };
type Move = { appt: Appointment; staffId: number; siteId: string; startMin: number };

export function DayView({
  site,
  sites,
  variant = "color",
  date,
  staff,
  columns,
  appointments,
  schedules,
  error,
  reload: load,
  services,
  canEdit,
  canSeeHistory = false,
  canDescribe = false,
  showCancelled = true,
  initialSelected = null,
  onOpenPatient,
  onOpenVisit,
}: Props) {
  const all = site === ALL_SITES;
  const mode: AllVariant | null = all ? variant : null;
  const [notice, setNotice] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [selected, setSelected] = useState<number | null>(initialSelected);
  const [move, setMove] = useState<Move | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  /** The free slot under the mouse, as in Versum: its start time shows in the slot's top-left corner.
   *  Mouse only: touch screens have no hover and keep the plain tap-to-book. */
  const [hover, setHover] = useState<Hover | null>(null);
  const dragOffsetMin = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  // A visit opened from the patient card: bring it into view once its column is drawn.
  const scrolledTo = useRef(false);
  useEffect(() => {
    if (!initialSelected || scrolledTo.current) return;
    const el = scroller.current?.querySelector(`[data-appt="${initialSelected}"]`);
    if (!el) return;
    scrolledTo.current = true;
    el.scrollIntoView({ block: "center", inline: "center" });
  });

  // Each column's visits and hours; a column limited to one clinic ("columns" variant) only gets that clinic's.
  const byColumn = useMemo(() => {
    const map = new Map<string, { appts: Appointment[]; blocks: ScheduleBlock[] }>();
    for (const c of columns) {
      map.set(c.key, {
        appts: appointments.filter(
          (a) =>
            a.staffId === c.staff.id &&
            (c.siteId === null || a.siteId === c.siteId) &&
            (showCancelled || (a.status !== "cancelled" && a.status !== "no_show")),
        ),
        blocks: schedules.filter((b) => b.staffId === c.staff.id && (c.siteId === null || b.siteId === c.siteId)),
      });
    }
    return map;
  }, [columns, appointments, schedules, showCancelled]);

  // Column groups for the "columns" variant: one header over each clinic's people.
  const groups = useMemo(() => {
    if (mode !== "columns") return [];
    const out: { siteId: string; count: number }[] = [];
    for (const c of columns) {
      const last = out.at(-1);
      if (last && last.siteId === c.siteId) last.count++;
      else out.push({ siteId: c.siteId!, count: 1 });
    }
    return out;
  }, [columns, mode]);
  const groupStart = (i: number) => mode === "columns" && i > 0 && columns[i - 1]!.siteId !== columns[i]!.siteId;

  // The click and the hover label use the same maths, so the time shown is the slot that opens.
  const minutesFromEvent = (e: { clientY: number; currentTarget: HTMLElement }) =>
    slotAt(e.clientY - e.currentTarget.getBoundingClientRect().top, PX_PER_MIN);

  // A drop only proposes the move; the dialog asks before anything changes.
  const onDrop = (e: DragEvent<HTMLDivElement>, column: CalendarColumn) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/appointment"));
    const appt = appointments.find((a) => a.id === id);
    if (!appt) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = DAY_START_MIN + (e.clientY - rect.top) / PX_PER_MIN - dragOffsetMin.current;
    const startMin = Math.max(DAY_START_MIN, Math.round(raw / SLOT_MIN) * SLOT_MIN);
    const current = toClinicTime(appt.startsAt).minutes;
    const siteId = column.siteId ?? appt.siteId;
    if (startMin === current && column.staff.id === appt.staffId && siteId === appt.siteId) return;
    setMoveError(null);
    setMove({ appt, staffId: column.staff.id, siteId, startMin });
  };

  const confirmMove = async (notifyPatient: boolean) => {
    if (!move) return;
    setMoveBusy(true);
    setMoveError(null);
    try {
      const res = await api.updateAppointment(move.appt.id, {
        staffId: move.staffId,
        ...(move.siteId !== move.appt.siteId ? { siteId: move.siteId } : {}),
        startsAt: fromClinicTime(date, move.startMin).toISOString(),
        ...(notifyPatient ? { notifyPatient: true } : {}),
      });
      const parts = ["Przeniesiono wizytę."];
      if (res.sms) parts.push(res.sms);
      if (res.warnings.length) parts.push(`Uwaga: ${res.warnings.join(" ")}`);
      setNotice(parts.join(" "));
      setMove(null);
      load();
    } catch (err) {
      setMoveError((err as Error).message);
    } finally {
      setMoveBusy(false);
    }
  };
  const staffName = (id: number) => staff.find((s) => s.id === id)?.name ?? "?";

  const selectedAppt = appointments.find((a) => a.id === selected) ?? null;

  if (!staff.length) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {all ? "Brak aktywnych lekarzy." : "Brak lekarzy przypisanych do tej placówki."}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The visit count and "Pokaż odwołane" live in the header; this bar only shows up for a
            lost connection or the result of the last action. */}
        {(error || notice) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1 text-xs text-muted-foreground sm:px-4">
            {error && <span className="text-destructive">Brak połączenia: {error}</span>}
            {notice && (
              <button className="ml-auto text-foreground underline-offset-2 hover:underline" onClick={() => setNotice(null)}>
                {notice} ✕
              </button>
            )}
          </div>
        )}
        {!columns.length && (
          <p className="p-6 text-sm text-muted-foreground">
            Nikt nie jest zaznaczony: tego dnia nikt nie ma grafiku albo odznaczono wszystkich. Zaznacz osoby
            w panelu „Pracownicy”, żeby zobaczyć ich kolumny.
          </p>
        )}
        {/* Scrolls both ways: doctors' names stay on top and the hours stay on the left. On phones a
            column snaps into place after a swipe, about two doctors per screen. */}
        <div
          ref={scroller}
          className={`min-h-0 flex-1 overflow-auto overscroll-contain max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-pl-12 ${columns.length ? "" : "hidden"}`}
          style={{ "--cols": columns.length } as CSSProperties}
        >
          <div className={`sticky top-0 z-20 border-b border-border bg-surface`}>
            {groups.length > 0 && (
              <div className={ROW} data-testid="site-groups">
                <div className="sticky left-0 z-10 w-12 shrink-0 bg-surface sm:w-14" />
                {groups.map((g, i) => (
                  <div
                    key={g.siteId}
                    className={`min-w-0 basis-0 border-b-2 px-2 py-0.5 text-xs font-semibold ${i > 0 ? "border-l-4 border-l-border" : "border-l border-l-border"}`}
                    style={{ flexGrow: g.count, borderBottomColor: siteColor(g.siteId), color: siteColor(g.siteId) }}
                  >
                    {siteName(sites, g.siteId)}
                  </div>
                ))}
              </div>
            )}
            <div className={ROW}>
              <div className="sticky left-0 z-10 w-12 shrink-0 bg-surface sm:w-14" />
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className={`${COLUMN} border-t-4 px-2 py-1 text-xs font-medium ${groupStart(i) ? "border-l-4 border-l-border" : "border-l border-l-border"}`}
                  style={{ borderTopColor: staffColor(c.staff) }}
                >
                  <span className="line-clamp-2">{c.staff.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`${ROW} relative`} style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN + 8 }}>
            <div className="sticky left-0 z-[15] w-12 shrink-0 bg-surface text-[11px] text-muted-foreground sm:w-14">
              {HOURS.map((h) => (
                <div key={h} className="absolute right-1.5 sm:right-2" style={{ top: (h - DAY_START_MIN) * PX_PER_MIN + 2 }}>
                  {formatMinutes(h)}
                </div>
              ))}
            </div>
            {columns.map((c, i) => {
              const s = c.staff;
              const col = byColumn.get(c.key)!;
              const placed = layoutColumn(
                col.appts.map((a) => ({
                  a,
                  startMin: toClinicTime(a.startsAt).minutes,
                  endMin: toClinicTime(a.endsAt).date === date ? toClinicTime(a.endsAt).minutes : DAY_END_MIN,
                })),
              );
              return (
                <div
                  key={c.key}
                  className={`${COLUMN} relative mt-2 snap-start border-border bg-calendar-off ${groupStart(i) ? "border-l-4" : "border-l"}`}
                  onClick={(e) => {
                    if (!canEdit || e.target !== e.currentTarget) return;
                    setBooking({ staffId: s.id, startMin: minutesFromEvent(e), siteId: c.siteId ?? (all ? null : site) });
                  }}
                  onPointerMove={(e) => {
                    if (!canEdit || e.pointerType !== "mouse" || e.target !== e.currentTarget || e.buttons) {
                      if (hover) setHover(null);
                      return;
                    }
                    const startMin = minutesFromEvent(e);
                    if (hover?.key !== c.key || hover.startMin !== startMin) setHover({ key: c.key, startMin });
                  }}
                  onPointerLeave={() => setHover(null)}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => onDrop(e, c)}
                  data-testid={`column-${c.key}`}
                >
                  {col.blocks.map((b) => {
                    const start = toClinicTime(b.startsAt);
                    const end = toClinicTime(b.endsAt);
                    const top = Math.max(start.date === date ? start.minutes : 0, DAY_START_MIN) - DAY_START_MIN;
                    const bottom = Math.min(end.date === date ? end.minutes : DAY_END_MIN, DAY_END_MIN) - DAY_START_MIN;
                    if (bottom <= top) return null;
                    return (
                      <div
                        key={b.id}
                        style={{
                          top: top * PX_PER_MIN,
                          height: (bottom - top) * PX_PER_MIN,
                          // "Kolor": the clinic's colour down the left edge of the working hours too.
                          ...(mode === "color" && b.kind === "work"
                            ? { boxShadow: `inset 3px 0 0 ${siteColor(b.siteId)}` }
                            : {}),
                        }}
                        className={`pointer-events-none absolute inset-x-0 ${
                          b.kind === "work"
                            ? "bg-calendar-on"
                            : "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--dp-muted)_6px,var(--dp-muted)_12px)]"
                        }`}
                        title={b.kind === "absence" ? "Nieobecność" : undefined}
                      />
                    );
                  })}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                      style={{ top: (h - DAY_START_MIN) * PX_PER_MIN }}
                    />
                  ))}
                  {hover?.key === c.key && (
                    <div
                      className="pointer-events-none absolute inset-x-0 rounded-sm bg-primary/10 px-1 text-[11px] font-medium leading-4 text-foreground ring-1 ring-inset ring-primary/40"
                      style={{ top: (hover.startMin - DAY_START_MIN) * PX_PER_MIN, height: SLOT_MIN * PX_PER_MIN }}
                      data-testid="hover-slot"
                    >
                      {formatMinutes(hover.startMin)}
                    </div>
                  )}
                  {placed.map(({ item: { a, startMin, endMin }, top, height, lane, lanes }) => (
                    <button
                      key={a.id}
                      draggable={canEdit && a.status !== "cancelled"}
                      onDragStart={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        dragOffsetMin.current = (e.clientY - rect.top) / PX_PER_MIN;
                        e.dataTransfer.setData("text/appointment", String(a.id));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => setSelected(a.id)}
                      className={`absolute z-10 overflow-hidden rounded-sm border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ${
                        STATUS_CLASSES[a.status]
                      } ${selected === a.id ? "ring-2 ring-ring" : ""}`}
                      style={{
                        top: top * PX_PER_MIN,
                        height: height * PX_PER_MIN - 1,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        ...(mode === "color" ? { borderLeftColor: siteColor(a.siteId) } : {}),
                      }}
                      title={all ? siteName(sites, a.siteId) : undefined}
                      data-site={a.siteId}
                      data-appt={a.id}
                    >
                      {mode === "label" && (
                        <span
                          className="mr-1 inline-block rounded-sm px-1 text-[10px] font-semibold leading-4 text-white"
                          style={{ background: siteColor(a.siteId) }}
                          data-testid="site-label"
                        >
                          {siteName(sites, a.siteId)}
                        </span>
                      )}
                      <span className="font-medium">
                        {formatMinutes(startMin)}–{formatMinutes(endMin)}{" "}
                        {a.patientName ?? a.title ?? "Blokada"}
                      </span>
                      {height >= 30 && (
                        <span className="block truncate opacity-80">
                          {a.serviceName ?? (a.patientName ? a.title ?? "Usługa spoza cennika" : "")}
                          {a.source === "bot" ? " · bot" : ""}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selectedAppt && (
        <AppointmentPanel
          key={selectedAppt.id}
          appointment={selectedAppt}
          staff={staff}
          sites={sites}
          onOpenPatient={onOpenPatient}
          onOpenVisit={onOpenVisit}
          canEdit={canEdit}
          canSeeHistory={canSeeHistory}
          canDescribe={canDescribe}
          onClose={() => setSelected(null)}
          onChanged={(message) => {
            setNotice(message);
            load();
          }}
        />
      )}
      {booking && (
        <BookingDialog
          siteId={booking.siteId}
          sites={sites}
          date={date}
          staff={staff}
          services={services}
          initial={booking}
          onClose={() => setBooking(null)}
          onBooked={(message) => {
            setBooking(null);
            setNotice(message);
            load();
          }}
        />
      )}
      {move && (
        <MoveDialog
          appointment={move.appt}
          from={{
            startMin: toClinicTime(move.appt.startsAt).minutes,
            staffName: staffName(move.appt.staffId),
            siteName: siteName(sites, move.appt.siteId),
          }}
          to={{ startMin: move.startMin, staffName: staffName(move.staffId), siteName: siteName(sites, move.siteId) }}
          busy={moveBusy}
          error={moveError}
          onConfirm={confirmMove}
          onCancel={() => setMove(null)}
        />
      )}
    </div>
  );
}
