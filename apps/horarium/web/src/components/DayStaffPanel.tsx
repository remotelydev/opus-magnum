import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import type { Staff } from "../lib/api.ts";
import { addMonths, AUTO, formatMonth, monthGrid, monthOf, staffColor, toggle, type ColumnChoice } from "../lib/columns.ts";
import { todayInClinic } from "../lib/time.ts";

const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];
const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

/**
 * The calendar's day and staff picker (like Versum's): a month to jump to any day, and the site's
 * people with a tick for each column shown. By default the ticks follow the work schedule of the day.
 */
export function DayStaffPanel({
  date,
  onDate,
  staff,
  selected,
  working,
  hours,
  auto,
  onChoice,
  onClose,
}: {
  date: string;
  onDate: (date: string) => void;
  /** Everyone at the site, in column order. */
  staff: Staff[];
  selected: Set<number>;
  /** Who works that day (schedule or a booked visit). */
  working: Set<number>;
  /** Work hours per person that day, e.g. "8:00–16:00". */
  hours: Map<number, string>;
  /** Whether the ticks follow the schedule (no manual choice yet). */
  auto: boolean;
  onChoice: (choice: ColumnChoice) => void;
  /** Tablets and phones, where the panel opens over the calendar. */
  onClose?: () => void;
}) {
  const [month, setMonth] = useState(monthOf(date));
  useEffect(() => setMonth(monthOf(date)), [date]);
  const today = todayInClinic();

  const atWork = staff.filter((s) => working.has(s.id));
  const others = staff.filter((s) => !working.has(s.id));
  const all = () => onChoice({ mode: "manual", ids: staff.map((s) => s.id) });

  const row = (s: Staff) => {
    const on = selected.has(s.id);
    return (
      <li key={s.id} className="group flex items-center rounded-md hover:bg-muted">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1 pointer-coarse:py-2">
          <input
            type="checkbox"
            checked={on}
            onChange={() => onChoice(toggle(selected, s.id))}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="size-3 shrink-0 rounded-sm" style={{ background: staffColor(s) }} aria-hidden="true" />
          <span className="min-w-0 leading-tight">
            <span className={cx("line-clamp-2 text-sm", !working.has(s.id) && "text-muted-foreground")}>{s.name}</span>
            {hours.get(s.id) && <span className="block text-[11px] text-muted-foreground">{hours.get(s.id)}</span>}
          </span>
        </label>
        <button
          type="button"
          onClick={() => onChoice({ mode: "manual", ids: [s.id] })}
          className="mr-1 hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground group-focus-within:block group-hover:block hover:bg-surface hover:text-foreground pointer-coarse:block pointer-coarse:py-1.5"
          title={`Pokaż tylko: ${s.name}`}
          aria-label={`Pokaż tylko: ${s.name}`}
        >
          tylko
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {onClose && (
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <h2 className="text-sm font-semibold">Dzień i pracownicy</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij panel"
            className="-mr-2 ml-auto flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XMarkIcon className="size-6" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* The month always stays in view; only the staff list below it scrolls. */}
      <section className="shrink-0 border-b border-border p-3" aria-label="Wybór dnia">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Poprzedni miesiąc"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <span className="text-sm font-medium capitalize" aria-live="polite">
            {formatMonth(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Następny miesiąc"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
          {monthGrid(month).map((d) => {
            const inMonth = monthOf(d) === month;
            const isSelected = d === date;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDate(d)}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={new Date(`${d}T12:00:00Z`).toLocaleDateString("pl-PL", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })}
                className={cx(
                  "h-7 rounded-md tabular-nums transition-colors pointer-coarse:h-10",
                  isSelected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : isToday
                      ? "font-semibold text-primary ring-1 ring-primary ring-inset hover:bg-primary-soft"
                      : inMonth
                        ? "text-foreground hover:bg-muted"
                        : "text-muted-foreground/60 hover:bg-muted",
                )}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col" aria-label="Pracownicy">
        <div className="shrink-0 px-2 pt-2">
          <div className="flex items-center gap-1 px-2 pt-1 pb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pracownicy <span className="font-normal normal-case tracking-normal">· {selected.size}/{staff.length}</span>
            </h3>
          </div>
          <div className="mb-2 flex flex-wrap gap-1 px-2 text-xs">
            <ChipButton active={auto} onClick={() => onChoice(AUTO)} title="Zaznacza osoby, które pracują w wybranym dniu">
              Wg grafiku
            </ChipButton>
            <ChipButton active={!auto && selected.size === staff.length} onClick={all}>
              Wszyscy
            </ChipButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {atWork.length > 0 && (
            <>
              <div className="px-2 pt-1 text-[11px] text-muted-foreground">Pracują tego dnia ({atWork.length})</div>
              <ul>{atWork.map(row)}</ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="px-2 pt-2 text-[11px] text-muted-foreground">
                {atWork.length ? `Pozostali (${others.length})` : "Nikt nie ma grafiku na ten dzień"}
              </div>
              <ul>{others.map(row)}</ul>
            </>
          )}
        </div>
      </section>

      {onClose && (
        <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Pokaż terminarz ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(
        "rounded-full border px-2.5 py-0.5 pointer-coarse:py-1.5",
        active ? "border-primary bg-primary-soft text-primary" : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
