import { STATUS_CLASSES } from "@opus-magnum/dentaplus-ui/components/status";
import { calendar } from "@opus-magnum/dentaplus-ui/tokens";
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api, type Appointment, type ScheduleBlock, type Service, type Staff } from "../lib/api.ts";
import { staffColor } from "../lib/columns.ts";
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

const PX_PER_MIN = calendar.pxPerMinute;
/** Every column gets an equal share; the rows are at least 9rem (8rem on desktops) per doctor wide,
 *  so two doctors fit a phone and about a dozen fit a 24-inch screen. Header and body use the same
 *  rule, so the names always sit above their columns. */
const COLUMN = "min-w-0 flex-1 basis-0";
const ROW = "flex min-w-[calc(3.5rem+var(--cols)*9rem)] lg:min-w-[calc(3.5rem+var(--cols)*8rem)]";
const HOURS = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 }, (_, i) => DAY_START_MIN + i * 60);


interface Props {
  site: string;
  date: string;
  /** Everyone at the site: the booking and visit dialogs can pick any of them. */
  staff: Staff[];
  /** The people ticked in the staff panel, one column each. */
  columns: Staff[];
  /** The day's data, loaded once for the calendar and the staff panel (see useDayData). */
  appointments: Appointment[];
  schedules: ScheduleBlock[];
  error: string | null;
  reload: () => void;
  services: Service[];
  canEdit: boolean;
  /** Admins see each patient's change log in the visit panel. */
  canSeeHistory?: boolean;
}

type Booking = { staffId: number; startMin: number };

export function DayView({
  site,
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
}: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showCancelled, setShowCancelled] = useState(true);
  /** The free slot under the mouse, as in Versum: its start time shows in the slot's top-left corner.
   *  Mouse only: touch screens have no hover and keep the plain tap-to-book. */
  const [hover, setHover] = useState<Booking | null>(null);
  const dragOffsetMin = useRef(0);

  const byStaff = useMemo(() => {
    const map = new Map<number, { appts: Appointment[]; blocks: ScheduleBlock[] }>();
    for (const s of staff) map.set(s.id, { appts: [], blocks: [] });
    for (const a of appointments) {
      if (!showCancelled && (a.status === "cancelled" || a.status === "no_show")) continue;
      map.get(a.staffId)?.appts.push(a);
    }
    for (const b of schedules) map.get(b.staffId)?.blocks.push(b);
    return map;
  }, [staff, appointments, schedules, showCancelled]);

  // The click and the hover label use the same maths, so the time shown is the slot that opens.
  const minutesFromEvent = (e: { clientY: number; currentTarget: HTMLElement }) =>
    slotAt(e.clientY - e.currentTarget.getBoundingClientRect().top, PX_PER_MIN);

  const onDrop = async (e: DragEvent<HTMLDivElement>, staffId: number) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/appointment"));
    const appt = appointments.find((a) => a.id === id);
    if (!appt) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = DAY_START_MIN + (e.clientY - rect.top) / PX_PER_MIN - dragOffsetMin.current;
    const startMin = Math.max(DAY_START_MIN, Math.round(raw / SLOT_MIN) * SLOT_MIN);
    const current = toClinicTime(appt.startsAt).minutes;
    if (startMin === current && staffId === appt.staffId) return;
    try {
      const res = await api.updateAppointment(id, {
        staffId,
        startsAt: fromClinicTime(date, startMin).toISOString(),
      });
      setNotice(res.warnings.length ? `Przeniesiono. Uwaga: ${res.warnings.join(" ")}` : "Przeniesiono wizytę.");
    } catch (err) {
      setNotice((err as Error).message);
    }
    load();
  };

  const selectedAppt = appointments.find((a) => a.id === selected) ?? null;
  const visibleIds = new Set(columns.map((s) => s.id));
  const visitCount = appointments.filter((a) => a.status !== "cancelled" && visibleIds.has(a.staffId)).length;

  if (!staff.length) {
    return <p className="p-6 text-sm text-muted-foreground">Brak lekarzy przypisanych do tej placówki.</p>;
  }
  const hiddenVisits = appointments.filter((a) => a.status !== "cancelled" && !visibleIds.has(a.staffId)).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1 text-xs text-muted-foreground sm:px-4">
          <span>{visitCount} wizyt</span>
          <label className="flex items-center gap-1 pointer-coarse:py-1">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Pokaż odwołane
          </label>
          {canEdit && (
            <>
              <span className="hidden pointer-fine:lg:inline">
                Kliknij wolne pole, żeby umówić. Przeciągnij wizytę, żeby ją przenieść.
              </span>
              <span className="hidden pointer-coarse:sm:inline">Dotknij wolnego pola, żeby umówić.</span>
            </>
          )}
          <span>
            {columns.length} z {staff.length} {staff.length === 1 ? "osoby" : "osób"}
          </span>
          {hiddenVisits > 0 && (
            <span className="text-foreground" title="Wizyty osób, które nie są zaznaczone w panelu Pracownicy">
              {hiddenVisits} wizyt u niezaznaczonych osób
            </span>
          )}
          {error && <span className="text-destructive">Brak połączenia: {error}</span>}
          {notice && (
            <button className="ml-auto text-foreground underline-offset-2 hover:underline" onClick={() => setNotice(null)}>
              {notice} ✕
            </button>
          )}
        </div>
        {!columns.length && (
          <p className="p-6 text-sm text-muted-foreground">
            Nikt nie jest zaznaczony: tego dnia nikt nie ma grafiku albo odznaczono wszystkich. Zaznacz osoby
            w panelu „Pracownicy”, żeby zobaczyć ich kolumny.
          </p>
        )}
        {/* Scrolls both ways: doctors' names stay on top and the hours stay on the left. On phones a
            column snaps into place after a swipe, about two doctors per screen. */}
        <div
          className={`min-h-0 flex-1 overflow-auto overscroll-contain max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-pl-12 ${columns.length ? "" : "hidden"}`}
          style={{ "--cols": columns.length } as CSSProperties}
        >
          <div className={`${ROW} sticky top-0 z-20 border-b border-border bg-surface`}>
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-surface sm:w-14" />
            {columns.map((s) => (
              <div
                key={s.id}
                className={`${COLUMN} border-t-4 border-l border-l-border px-2 py-1 text-xs font-medium`}
                style={{ borderTopColor: staffColor(s) }}
              >
                <span className="line-clamp-2">{s.name}</span>
              </div>
            ))}
          </div>
          <div className={`${ROW} relative`} style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN + 8 }}>
            <div className="sticky left-0 z-[15] w-12 shrink-0 bg-surface text-[11px] text-muted-foreground sm:w-14">
              {HOURS.map((h) => (
                <div key={h} className="absolute right-1.5 sm:right-2" style={{ top: (h - DAY_START_MIN) * PX_PER_MIN + 2 }}>
                  {formatMinutes(h)}
                </div>
              ))}
            </div>
            {columns.map((s) => {
              const col = byStaff.get(s.id)!;
              const placed = layoutColumn(
                col.appts.map((a) => ({
                  a,
                  startMin: toClinicTime(a.startsAt).minutes,
                  endMin: toClinicTime(a.endsAt).date === date ? toClinicTime(a.endsAt).minutes : DAY_END_MIN,
                })),
              );
              return (
                <div
                  key={s.id}
                  className={`${COLUMN} relative mt-2 snap-start border-l border-border bg-calendar-off`}
                  onClick={(e) => {
                    if (!canEdit || e.target !== e.currentTarget) return;
                    setBooking({ staffId: s.id, startMin: minutesFromEvent(e) });
                  }}
                  onPointerMove={(e) => {
                    if (!canEdit || e.pointerType !== "mouse" || e.target !== e.currentTarget || e.buttons) {
                      if (hover) setHover(null);
                      return;
                    }
                    const startMin = minutesFromEvent(e);
                    if (hover?.staffId !== s.id || hover.startMin !== startMin) setHover({ staffId: s.id, startMin });
                  }}
                  onPointerLeave={() => setHover(null)}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={(e) => onDrop(e, s.id)}
                  data-testid={`column-${s.id}`}
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
                        className={`pointer-events-none absolute inset-x-0 ${
                          b.kind === "work"
                            ? "bg-calendar-on"
                            : "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--dp-muted)_6px,var(--dp-muted)_12px)]"
                        }`}
                        style={{ top: top * PX_PER_MIN, height: (bottom - top) * PX_PER_MIN }}
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
                  {hover?.staffId === s.id && (
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
                      }}
                    >
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
          canEdit={canEdit}
          canSeeHistory={canSeeHistory}
          onClose={() => setSelected(null)}
          onChanged={(message) => {
            setNotice(message);
            load();
          }}
        />
      )}
      {booking && (
        <BookingDialog
          site={site}
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
    </div>
  );
}
