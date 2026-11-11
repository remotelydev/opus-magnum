import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { DayStaffPanel } from "./components/DayStaffPanel.tsx";
import { DayView } from "./components/DayView.tsx";
import { PatientsPage } from "./components/PatientsPage.tsx";
import { OpeningHoursPage } from "./components/OpeningHoursPage.tsx";
import { SchedulePage } from "./components/SchedulePage.tsx";
import { ServicesPage } from "./components/ServicesPage.tsx";
import { StaffPage } from "./components/StaffPage.tsx";
import { Login } from "./components/Login.tsx";
import { BottomNav, Sidebar, type View } from "./components/Sidebar.tsx";
import { api, ApiError, type Service, type Site, type Staff, type User } from "./lib/api.ts";
import { readChoice, saveChoice, selectedIds, workHours, workingIds, type ColumnChoice } from "./lib/columns.ts";
import { readCollapsed, saveCollapsed } from "./lib/sidebar.ts";
import { addDays, formatDay, todayInClinic } from "./lib/time.ts";
import { useDayData } from "./lib/useDayData.ts";
import { useMediaQuery } from "./lib/useMediaQuery.ts";

const SITE_KEY = "horarium.site";
/** Whether the day-and-staff panel is shown beside the calendar on wide screens. */
const DAY_PANEL_KEY = "horarium.dayPanel";

function readPanelPinned(): boolean {
  try {
    return localStorage.getItem(DAY_PANEL_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function readSite(): string | null {
  try {
    return localStorage.getItem(SITE_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((error) => setUser(error instanceof ApiError && error.status === 401 ? null : null));
  }, []);

  if (user === undefined) return <div className="p-6 text-sm text-muted-foreground">Ładowanie…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Workspace user={user} onLogout={() => setUser(null)} />;
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [site, setSite] = useState<string>(readSite() ?? "turek");
  const [date, setDate] = useState(todayInClinic());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("calendar");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [scheduleStaff, setScheduleStaff] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which people get a column: whoever works that day, or the user's own ticks (remembered per site).
  const [choice, setChoice] = useState<ColumnChoice>(() => readChoice(readSite() ?? "turek"));
  // Wide screens (1024 px and up) dock the day-and-staff panel beside the calendar; narrower ones
  // open it over the calendar from the button in the bar.
  const wide = useMediaQuery("(min-width: 64rem)");
  const [panelPinned, setPanelPinned] = useState(readPanelPinned);
  const [panelOpen, setPanelOpen] = useState(false);
  const day = useDayData(site, date, view === "calendar");

  useEffect(() => {
    if (!menuOpen && !panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, panelOpen]);

  useEffect(() => {
    if (wide) setPanelOpen(false);
  }, [wide]);

  const toggleCollapsed = () => {
    setCollapsed((was) => {
      saveCollapsed(!was);
      return !was;
    });
  };

  useEffect(() => {
    // Reference data for the calendar and patients; reloaded on return so settings changes show up.
    if (view !== "calendar" && view !== "patients") return;
    Promise.all([api.sites(), api.staff(), api.services()])
      .then(([si, st, se]) => {
        setSites(si);
        setStaff(st);
        setServices(se);
      })
      .catch((e: Error) => setError(e.message));
  }, [view]);

  const chooseSite = (id: string) => {
    setSite(id);
    setChoice(readChoice(id));
    try {
      localStorage.setItem(SITE_KEY, id);
    } catch {
      /* private mode: remember for this tab only */
    }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    onLogout();
  };

  const openView = (next: View) => {
    if (next === "schedule") setScheduleStaff(null);
    setView(next);
    setMenuOpen(false);
  };
  const siteStaff = useMemo(() => staff.filter((s) => s.active && s.sites.includes(site)), [staff, site]);

  // Until the new day's schedule arrives, keep the previous day's set so the columns do not jump.
  const lastWorking = useRef<Set<number>>(new Set());
  const working = useMemo(() => {
    if (!day.loaded) return lastWorking.current;
    return (lastWorking.current = workingIds(date, day.schedules, day.appointments));
  }, [day.loaded, day.schedules, day.appointments, date]);
  const hours = useMemo(() => workHours(date, day.schedules), [date, day.schedules]);
  const selected = useMemo(() => selectedIds(siteStaff, choice, working), [siteStaff, choice, working]);
  const columns = siteStaff.filter((s) => selected.has(s.id));

  const changeChoice = (next: ColumnChoice) => {
    setChoice(next);
    saveChoice(site, next);
  };
  const togglePanel = () => {
    if (!wide) return setPanelOpen((open) => !open);
    setPanelPinned((was) => {
      try {
        localStorage.setItem(DAY_PANEL_KEY, was ? "hidden" : "shown");
      } catch {
        /* private mode */
      }
      return !was;
    });
  };
  const panelShown = wide ? panelPinned : panelOpen;
  const panel = (drawer: boolean) => (
    <DayStaffPanel
      date={date}
      onDate={(d) => {
        setDate(d);
        if (drawer) setPanelOpen(false);
      }}
      staff={siteStaff}
      selected={selected}
      working={working}
      hours={hours}
      auto={choice.mode === "auto"}
      onChoice={changeChoice}
      onClose={drawer ? () => setPanelOpen(false) : undefined}
    />
  );

  return (
    <div className="flex h-full bg-background text-foreground">
      {/* Tablets and desktops: the side panel. Phones: a bottom bar and the same panel as a drawer. */}
      <div className="hidden md:flex">
        <Sidebar
          user={user}
          view={view}
          onView={openView}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onLogout={logout}
        />
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <Sidebar
            className="relative h-full max-w-[85vw] shadow-xl"
            user={user}
            view={view}
            onView={openView}
            collapsed={false}
            onLogout={logout}
            onClose={() => setMenuOpen(false)}
          />
        </div>
      )}
      {panelOpen && view === "calendar" && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Dzień i pracownicy">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPanelOpen(false)} />
          <div className="relative h-full w-80 max-w-full shadow-xl max-sm:w-full">{panel(true)}</div>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        {view === "calendar" && (
          <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
            <h1 className="mr-1 text-base font-semibold capitalize">{formatDay(date)}</h1>
            <div className="flex items-center gap-1 max-sm:order-last max-sm:w-full">
              <Button
                variant="outline"
                size="icon"
                aria-label="Poprzedni dzień"
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDate(todayInClinic())}>
                Dziś
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Następny dzień"
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRightIcon />
              </Button>
              <Button
                variant={panelShown ? "primary" : "outline"}
                size="sm"
                className="ml-1 max-sm:ml-auto"
                onClick={togglePanel}
                aria-expanded={panelShown}
                title={panelShown ? "Ukryj panel dnia i pracowników" : "Wybierz dzień i pracowników"}
              >
                <UserGroupIcon className="size-4" aria-hidden="true" />
                Pracownicy {selected.size}/{siteStaff.length}
              </Button>
            </div>
            <div
              className="ml-auto flex overflow-hidden rounded-md border border-input"
              role="tablist"
              aria-label="Placówka"
            >
              {sites.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === site}
                  onClick={() => chooseSite(s.id)}
                  className={`px-3 py-1 text-xs pointer-coarse:py-2 ${s.id === site ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-muted"}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </header>
        )}
        {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
        {view === "services" ? (
          <ServicesPage />
        ) : view === "staff" ? (
          <StaffPage
            onOpenSchedule={(id) => {
              setScheduleStaff(id);
              setView("schedule");
            }}
          />
        ) : view === "schedule" ? (
          <SchedulePage initialStaffId={scheduleStaff} />
        ) : view === "opening" ? (
          <OpeningHoursPage />
        ) : view === "patients" ? (
          <PatientsPage
            sites={sites}
            staff={staff}
            canEdit={user.role !== "doctor"}
            canSeeHistory={user.role === "admin"}
            onOpenDay={(siteId, day) => {
              chooseSite(siteId);
              setDate(day);
              setView("calendar");
            }}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            {wide && panelPinned && (
              <aside className="w-64 shrink-0 border-r border-border" aria-label="Dzień i pracownicy">
                {panel(false)}
              </aside>
            )}
            <DayView
              key={`${site}-${date}`}
              site={site}
              date={date}
              staff={siteStaff}
              columns={columns}
              appointments={day.appointments}
              schedules={day.schedules}
              error={day.error}
              reload={day.reload}
              services={services}
              canEdit={user.role !== "doctor"}
              canSeeHistory={user.role === "admin"}
            />
          </div>
        )}
        <BottomNav view={view} onView={openView} onMenu={() => setMenuOpen((o) => !o)} menuOpen={menuOpen} />
      </main>
    </div>
  );
}
