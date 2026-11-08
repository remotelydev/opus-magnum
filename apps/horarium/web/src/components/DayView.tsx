import { STATUS_CLASSES } from "@opus-magnum/dentaplus-ui/components/status";
import { calendar } from "@opus-magnum/dentaplus-ui/tokens";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api, type Appointment, type ScheduleBlock, type Service, type Staff } from "../lib/api.ts";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  SLOT_MIN,
  addDays,
  formatMinutes,
  fromClinicTime,
  layoutColumn,
  toClinicTime,
} from "../lib/time.ts";
import { AppointmentPanel } from "./AppointmentPanel.tsx";
import { BookingDialog } from "./BookingDialog.tsx";

const PX_PER_MIN = calendar.pxPerMinute;
const REFRESH_MS = 30_000;
const HOURS = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 }, (_, i) => DAY_START_MIN + i * 60);


interface Props {
  site: string;
  date: string;
  staff: Staff[];
  services: Service[];
  canEdit: boolean;
}

type Booking = { staffId: number; startMin: number };

export function DayView({ site, date, staff, services, canEdit }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [schedules, setSchedules] = useState<ScheduleBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showCancelled, setShowCancelled] = useState(true);
  const dragOffsetMin = useRef(0);

  const range = useMemo(
    () => ({ from: fromClinicTime(date, 0).toISOString(), to: fromClinicTime(addDays(date, 1), 0).toISOString() }),
    [date],
  );

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        api.appointments(site, range.from, range.to),
        api.schedules(site, range.from, range.to),
      ]);
      setAppointments(a);
      setSchedules(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site, range]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

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

  const minutesFromEvent = (e: { clientY: number; currentTarget: HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = DAY_START_MIN + (e.clientY - rect.top) / PX_PER_MIN;
    return Math.min(Math.max(Math.floor(raw / SLOT_MIN) * SLOT_MIN, DAY_START_MIN), DAY_END_MIN - SLOT_MIN);
  };

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

  if (!staff.length) {
    return <p className="p-6 text-sm text-muted-foreground">Brak lekarzy przypisanych do tej placówki.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-border px-4 py-1 text-xs text-muted-foreground">
          <span>{appointments.filter((a) => a.status !== "cancelled").length} wizyt</span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Pokaż odwołane
          </label>
          {canEdit && <span>Kliknij wolne pole, żeby umówić. Przeciągnij wizytę, żeby ją przenieść.</span>}
          {error && <span className="text-destructive">Brak połączenia: {error}</span>}
          {notice && (
            <button className="ml-auto text-foreground underline-offset-2 hover:underline" onClick={() => setNotice(null)}>
              {notice} ✕
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
            <div className="w-14 shrink-0" />
            {staff.map((s) => (
              <div key={s.id} className="min-w-40 flex-1 border-l border-border px-2 py-1.5 text-xs font-medium">
                {s.name}
              </div>
            ))}
          </div>
          <div className="relative flex" style={{ height: (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN }}>
            <div className="relative w-14 shrink-0 text-[11px] text-muted-foreground">
              {HOURS.map((h) => (
                <div key={h} className="absolute right-2" style={{ top: (h - DAY_START_MIN) * PX_PER_MIN - 6 }}>
                  {formatMinutes(h)}
                </div>
              ))}
            </div>
            {staff.map((s) => {
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
                  className="relative min-w-40 flex-1 border-l border-border bg-calendar-off"
                  onClick={(e) => {
                    if (!canEdit || e.target !== e.currentTarget) return;
                    setBooking({ staffId: s.id, startMin: minutesFromEvent(e) });
                  }}
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
