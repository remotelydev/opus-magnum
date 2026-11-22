import type { AppointmentStatusToken } from "../tokens/tokens.ts";
import { cx } from "../lib/cx.ts";

/** A visit's status: the coloured ones plus "deleted", kept only for the history of visits removed in Versum. */
export type AppointmentStatusKey = AppointmentStatusToken | "deleted";

/** Literal class strings so Tailwind can see them. Colours come from the status-* tokens. */
export const STATUS_CLASSES: Record<AppointmentStatusToken, string> = {
  booked: "bg-status-booked border-status-booked-accent text-status-booked-foreground",
  confirmed: "bg-status-confirmed border-status-confirmed-accent text-status-confirmed-foreground",
  done: "bg-status-done border-status-done-accent text-status-done-foreground",
  no_show: "bg-status-no-show border-status-no-show-accent text-status-no-show-foreground",
  cancelled:
    "bg-status-cancelled border-dashed border-status-cancelled-accent text-status-cancelled-foreground line-through",
};

/** Classes for any status; a deleted visit looks like a cancelled one. */
export const statusClasses = (status: AppointmentStatusKey) => STATUS_CLASSES[status === "deleted" ? "cancelled" : status];

export const STATUS_LABEL: Record<AppointmentStatusKey, string> = {
  booked: "Umówiona",
  confirmed: "Potwierdzona",
  done: "Zakończona",
  no_show: "Nie przyszedł",
  cancelled: "Odwołana",
  deleted: "Usunięta",
};

export function StatusBadge({ status, className }: { status: AppointmentStatusKey; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-sm border-l-4 px-1.5 py-0.5 text-xs", statusClasses(status), className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}
