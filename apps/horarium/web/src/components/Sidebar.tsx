import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  BuildingStorefrontIcon,
  CalendarDaysIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ClipboardDocumentListIcon,
  MoonIcon,
  SunIcon,
  ClockIcon,
  IdentificationIcon,
  TagIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode, SVGProps } from "react";
import type { User } from "../lib/api.ts";
import { useTheme } from "./ThemeToggle.tsx";

export type View = "calendar" | "patients" | "intake" | "services" | "staff" | "schedule" | "opening";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

const ROLE_LABEL: Record<User["role"], string> = {
  admin: "administrator",
  reception: "recepcja",
  doctor: "lekarz",
};

/** Left panel: logo, sections, and the user's settings at the bottom. Collapses to icons. */
export function Sidebar({
  user,
  view,
  onView,
  collapsed,
  onToggleCollapsed,
  onLogout,
  onClose,
  className,
}: {
  user: User;
  view: View;
  onView: (view: View) => void;
  collapsed: boolean;
  /** Left out on phones, where the panel opens as a drawer instead of collapsing. */
  onToggleCollapsed?: () => void;
  onLogout: () => void;
  /** Phone drawer: shows a close button in the header. */
  onClose?: () => void;
  className?: string;
}) {
  const theme = useTheme();
  const items: Array<{ id: View; label: string; icon: Icon }> = [
    { id: "calendar", label: "Terminarz", icon: CalendarDaysIcon },
    { id: "patients", label: "Pacjenci", icon: UsersIcon },
    ...(user.role !== "doctor" ? [{ id: "intake" as const, label: "Rejestracje", icon: ClipboardDocumentListIcon }] : []),
  ];
  const admin = user.role === "admin";
  const settings: Array<{ id: View; label: string; icon: Icon }> = [
    ...(user.role !== "doctor" ? [{ id: "schedule" as const, label: "Grafik pracy", icon: ClockIcon }] : []),
    ...(admin
      ? [
          { id: "staff" as const, label: "Pracownicy", icon: IdentificationIcon },
          { id: "opening" as const, label: "Godziny otwarcia", icon: BuildingStorefrontIcon },
          { id: "services" as const, label: "Usługi i cennik", icon: TagIcon },
        ]
      : []),
  ];
  const initials = user.name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <aside
      className={cx(
        "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150",
        collapsed ? "w-16" : "w-60",
        className,
      )}
      aria-label="Panel boczny"
    >
      <div
        className={cx("flex h-14 items-center gap-2.5 border-b border-border", collapsed ? "justify-center" : "px-4")}
      >
        <Logo />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold text-foreground">Horarium</div>
            <div className="text-xs text-muted-foreground">DentaPlus+</div>
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij menu"
            className="-mr-1 ml-auto flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XMarkIcon className="size-6" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="Sekcje">
        {items.map((item) => (
          <Item
            key={item.id}
            icon={item.icon}
            label={item.label}
            collapsed={collapsed}
            active={view === item.id}
            onClick={() => onView(item.id)}
          />
        ))}
        {settings.length > 0 &&
          (collapsed ? (
            <div className="mx-2 my-2 border-t border-border" role="separator" />
          ) : (
            <div className="px-2.5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ustawienia
            </div>
          ))}
        {settings.map((item) => (
          <Item
            key={item.id}
            icon={item.icon}
            label={item.label}
            collapsed={collapsed}
            active={view === item.id}
            onClick={() => onView(item.id)}
          />
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div
          className={cx("mb-1 flex items-center gap-2.5 rounded-md py-1.5", collapsed ? "justify-center" : "px-2")}
          title={collapsed ? `${user.name} (${ROLE_LABEL[user.role]})` : undefined}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials || "?"}
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</div>
            </div>
          )}
        </div>
        <Item
          icon={theme.theme === "dark" ? MoonIcon : SunIcon}
          label={theme.theme === "dark" ? "Motyw: ciemny" : "Motyw: jasny"}
          title={theme.label}
          collapsed={collapsed}
          onClick={theme.toggle}
        />
        <Item icon={ArrowRightStartOnRectangleIcon} label="Wyloguj" collapsed={collapsed} onClick={onLogout} />
        {onToggleCollapsed && (
          <Item
            icon={collapsed ? ChevronDoubleRightIcon : ChevronDoubleLeftIcon}
            label="Zwiń panel"
            title={collapsed ? "Rozwiń panel" : "Zwiń panel"}
            collapsed={collapsed}
            onClick={onToggleCollapsed}
            ariaExpanded={!collapsed}
          />
        )}
      </div>
    </aside>
  );
}

function Item({
  icon: Icon,
  label,
  title,
  collapsed,
  active,
  onClick,
  ariaExpanded,
}: {
  icon: Icon;
  label: string;
  title?: string;
  collapsed: boolean;
  active?: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
}): ReactNode {
  const name = title ?? label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-expanded={ariaExpanded}
      aria-label={collapsed || title ? name : undefined}
      title={collapsed || title ? name : undefined}
      className={cx(
        "flex h-9 items-center gap-3 rounded-md text-sm transition-colors pointer-coarse:h-11",
        collapsed ? "justify-center" : "px-2.5",
        active
          ? "bg-primary-soft font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

/** Phones: the sections people open most, always at the thumb, and the full menu as a drawer. */
export function BottomNav({
  view,
  onView,
  onMenu,
  menuOpen,
}: {
  view: View;
  onView: (view: View) => void;
  onMenu: () => void;
  menuOpen: boolean;
}) {
  const tab = (active: boolean) =>
    cx(
      "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
      active ? "text-primary" : "text-muted-foreground",
    );
  const settingsActive = view !== "calendar" && view !== "patients";
  return (
    <nav
      className="flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Nawigacja"
    >
      <button type="button" className={cx("h-14", tab(view === "calendar"))} onClick={() => onView("calendar")} aria-current={view === "calendar" ? "page" : undefined}>
        <CalendarDaysIcon className="size-6" aria-hidden="true" />
        Terminarz
      </button>
      <button type="button" className={cx("h-14", tab(view === "patients"))} onClick={() => onView("patients")} aria-current={view === "patients" ? "page" : undefined}>
        <UsersIcon className="size-6" aria-hidden="true" />
        Pacjenci
      </button>
      <button type="button" className={cx("h-14", tab(settingsActive || menuOpen))} onClick={onMenu} aria-expanded={menuOpen} aria-haspopup="dialog">
        <Bars3Icon className="size-6" aria-hidden="true" />
        Menu
      </button>
    </nav>
  );
}

/** Placeholder mark until the clinic supplies its own logo. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M10 9v14M22 9v14M10 16h12"
        className="stroke-primary-foreground"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
