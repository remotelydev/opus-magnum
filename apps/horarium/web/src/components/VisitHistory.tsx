import { StatusBadge } from "@opus-magnum/dentaplus-ui/components/status";
import { STATUS_LABEL, type Appointment, type Site, type Staff } from "../lib/api.ts";
import { siteName } from "../lib/sites.ts";
import { formatMinutes, toClinicTime } from "../lib/time.ts";

const dateFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const formatDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

interface Props {
  /** Newest first. */
  visits: Appointment[];
  staff: Staff[];
  sites: Site[];
  /** Show only this many, newest first. */
  limit?: number;
  /** Smaller type for the visit panel beside the calendar. */
  compact?: boolean;
  /** Opens the visit in the calendar. */
  onOpenVisit?: (siteId: string, date: string, appointmentId: number) => void;
}

/**
 * A patient's visits, each with when, what, who and where (the clinic), and its note written out in
 * full so earlier visits can be read through. Used in the patient card and in the visit panel.
 */
export function VisitHistory({ visits, staff, sites, limit, compact = false, onOpenVisit }: Props) {
  const shown = limit ? visits.slice(0, limit) : visits;
  if (!shown.length) return <p className="text-sm text-muted-foreground">Brak.</p>;
  const doctor = (id: number) => staff.find((s) => s.id === id)?.name ?? "?";
  const text = compact ? "text-xs" : "text-sm";

  return (
    <ul className={`divide-y divide-border rounded-md border border-border ${text}`}>
      {shown.map((a) => {
        const t = toClinicTime(a.startsAt);
        return (
          <li key={a.id} className={compact ? "px-2 py-1.5" : "px-3 py-2"}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {onOpenVisit ? (
                <button
                  className="tabular-nums font-medium underline-offset-2 hover:underline"
                  onClick={() => onOpenVisit(a.siteId, t.date, a.id)}
                  title="Pokaż tę wizytę w terminarzu"
                >
                  {formatDate(t.date)}, {formatMinutes(t.minutes)}
                </button>
              ) : (
                <span className="tabular-nums font-medium">
                  {formatDate(t.date)}, {formatMinutes(t.minutes)}
                </span>
              )}
              <span className="min-w-0 flex-1">{a.serviceName ?? a.title ?? "Wizyta"}</span>
              {!compact && <StatusBadge status={a.status} />}
            </div>
            <p className="text-muted-foreground">
              {doctor(a.staffId)} · <span data-testid="visit-site">{siteName(sites, a.siteId)}</span>
              {compact ? ` · ${STATUS_LABEL[a.status]}` : ""}
            </p>
            {a.treatmentNotes && (
              <p className="mt-1 whitespace-pre-line" data-testid="treatment">
                <span className="font-medium">Opis leczenia: </span>
                {a.treatmentNotes}
              </p>
            )}
            {a.notes && (
              <p className="mt-1 whitespace-pre-line text-muted-foreground">
                <span className="font-medium">Notatka: </span>
                {a.notes}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
