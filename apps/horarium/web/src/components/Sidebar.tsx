import {
  ArrowRightStartOnRectangleIcon,
  CalendarDaysIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  MoonIcon,
  SunIcon,
  TagIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode, SVGProps } from "react";
import type { User } from "../lib/api.ts";
import { useTheme } from "./ThemeToggle.tsx";

export type View = "calendar" | "patients" | "services";

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
}: {
  user: User;
  view: View;
  onView: (view: View) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onLogout: () => void;
}) {
  const theme = useTheme();
  const items: Array<{ id: View; label: string; icon: Icon }> = [
    { id: "calendar", label: "Terminarz", icon: CalendarDaysIcon },
    { id: "patients", label: "Pacjenci", icon: UsersIcon },
    ...(user.role === "admin" ? [{ id: "services" as const, label: "Usługi i cennik", icon: TagIcon }] : []),
  ];
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <aside
      className={cx(
        "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150",
        collapsed ? "w-16" : "w-60",
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
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-2">
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
        <Item
          icon={collapsed ? ChevronDoubleRightIcon : ChevronDoubleLeftIcon}
          label="Zwiń panel"
          title={collapsed ? "Rozwiń panel" : "Zwiń panel"}
          collapsed={collapsed}
          onClick={onToggleCollapsed}
          ariaExpanded={!collapsed}
        />
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
        "flex h-9 items-center gap-3 rounded-md text-sm transition-colors",
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
