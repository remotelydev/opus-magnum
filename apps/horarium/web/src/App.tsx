import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { DayStaffPanel } from "./components/DayStaffPanel.tsx";
import { DayView } from "./components/DayView.tsx";
import { IntakePage } from "./components/IntakePage.tsx";
import { PatientsPage } from "./components/PatientsPage.tsx";
import { OpeningHoursPage } from "./components/OpeningHoursPage.tsx";
import { SchedulePage } from "./components/SchedulePage.tsx";
import { ServicesPage } from "./components/ServicesPage.tsx";
import { StaffPage } from "./components/StaffPage.tsx";
import { StatisticsPage } from "./components/StatisticsPage.tsx";
import { Login } from "./components/Login.tsx";
import { BottomNav, Sidebar, type View } from "./components/Sidebar.tsx";
import { api, ApiError, isClinical, type Service, type Site, type Staff, type User } from "./lib/api.ts";
import { readChoice, saveChoice, selectedIds, workHours, workingIds, type ColumnChoice } from "./lib/columns.ts";
import { readCollapsed, saveCollapsed } from "./lib/sidebar.ts";
import { ALL_SITES, calendarColumns, siteColor } from "./lib/sites.ts";
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
  const [openPatient, setOpenPatient] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which people get a column: whoever works that day, or the user's own ticks (remembered per site).
  const [choice, setChoice] = useState<ColumnChoice>(() => readChoice(readSite() ?? "turek"));
  // Wide screens (1024 px and up) dock the day-and-staff panel beside the calendar; narrower ones
  // open it over the calendar from the button in the bar.
  const wide = useMediaQuery("(min-width: 64rem)");
  const [panelPinned, setPanelPinned] = useState(readPanelPinned);
  const [panelOpen, setPanelOpen] = useState(false);
  const day = useDayData(site, date, view === "calendar");
  const [showCancelled, setShowCancelled] = useState(true);
  // Links between the calendar and the patient card: the visit to open, the card to open.
  const [focusVisit, setFocusVisit] = useState<number | null>(null);
  const all = site === ALL_SITES;

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
    if (view !== "calendar" && view !== "patients" && view !== "intake" && view !== "stats") return;
    Promise.all([api.sites(), api.staff(), api.services()])
      .then(([si, st, se]) => {
        setSites(si);
        setStaff(st);
        setServices(se);
      })
      .catch((e: Error) => setError(e.message));
  }, [view]);

  /** The user moving to another day: a visit opened from the patient card stays behind. */
  const goTo = (d: string) => {
    setDate(d);
    setFocusVisit(null);
  };

  const chooseSite = (id: string) => {
    setSite(id);
    setFocusVisit(null);
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

  const openVisit = (siteId: string, day: string, appointmentId: number) => {
    // Stay on "Wszystkie" when it is on: the visit is there too.
    if (!all) chooseSite(siteId);
    setDate(day);
    setFocusVisit(appointmentId);
    setView("calendar");
  };

  const openPatientCard = (patientId: number) => {
    setOpenPatient(patientId);
    setView("patients");
  };

  const openView = (next: View) => {
    if (next === "schedule") setScheduleStaff(null);
    if (next === "patients") setOpenPatient(null);
    setView(next);
    setMenuOpen(false);
  };
  const siteStaff = useMemo(
    () => staff.filter((s) => s.active && (site === ALL_SITES || s.sites.includes(site))),
    [staff, site],
  );

  // Until the new day's schedule arrives, keep the previous day's set so the columns do not jump.
  const lastWorking = useRef<Set<number>>(new Set());
  const working = useMemo(() => {
    if (!day.loaded) return lastWorking.current;
    return (lastWorking.current = workingIds(date, day.schedules, day.appointments));
  }, [day.loaded, day.schedules, day.appointments, date]);
  const hours = useMemo(() => workHours(date, day.schedules), [date, day.schedules]);
  const selected = useMemo(() => selectedIds(siteStaff, choice, working), [siteStaff, choice, working]);
  const columns = useMemo(
    () => calendarColumns(siteStaff.filter((s) => selected.has(s.id))),
    [siteStaff, selected],
  );
  const liveVisits = day.appointments.filter((a) => a.status !== "cancelled");
  const visitCount = liveVisits.filter((a) => selected.has(a.staffId)).length;
  const hiddenVisits = liveVisits.length - visitCount;

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
        goTo(d);
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
                onClick={() => goTo(addDays(date, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="sm" onClick={() => goTo(todayInClinic())}>
                Dziś
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Następny dzień"
                onClick={() => goTo(addDays(date, 1))}
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
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {visitCount} wizyt
                {hiddenVisits > 0 && (
                  <span className="text-foreground" title="Wizyty osób, które nie są zaznaczone w panelu Pracownicy">
                    {" "}
                    (+{hiddenVisits} u niezaznaczonych)
                  </span>
                )}
              </span>
              <label className="flex items-center gap-1 pointer-coarse:py-1">
                <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
                Pokaż odwołane
              </label>
            </div>
            <div
              className="ml-auto flex overflow-hidden rounded-md border border-input"
              role="tablist"
              aria-label="Placówka"
            >
              {[...sites, { id: ALL_SITES, name: "Wszystkie" }].map((s) => {
                // Each clinic in its own colour, the same as on the calendar: filled when chosen, a dot otherwise.
                const color = s.id === ALL_SITES ? null : siteColor(s.id);
                const on = s.id === site;
                return (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => chooseSite(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs pointer-coarse:py-2 ${on ? (color ? "text-white" : "bg-primary text-primary-foreground") : "bg-surface hover:bg-muted"}`}
                    style={on && color ? { background: color } : undefined}
                  >
                    {color && !on && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </header>
        )}
        {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
        {view === "stats" ? (
          <StatisticsPage user={user} sites={sites} staff={staff} />
        ) : view === "services" ? (
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
        ) : view === "intake" ? (
          <IntakePage
            sites={sites}
            onOpenPatient={(id) => {
              setOpenPatient(id);
              setView("patients");
            }}
          />
        ) : view === "patients" ? (
          <PatientsPage
            key={openPatient ?? "list"}
            initialPatientId={openPatient}
            sites={sites}
            services={services}
            site={site}
            staff={staff}
            canEdit={!isClinical(user.role)}
            canSeeHistory={user.role === "admin"}
            onOpenDay={openVisit}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            {wide && panelPinned && (
              <aside className="w-64 shrink-0 border-r border-border" aria-label="Dzień i pracownicy">
                {panel(false)}
              </aside>
            )}
            <DayView
              key={`${site}-${date}-${focusVisit ?? ""}`}
              site={site}
              sites={sites}
              initialSelected={focusVisit}
              onOpenPatient={openPatientCard}
              onOpenVisit={openVisit}
              date={date}
              staff={siteStaff}
              columns={columns}
              appointments={day.appointments}
              schedules={day.schedules}
              error={day.error}
              reload={day.reload}
              services={services}
              canEdit={!isClinical(user.role)}
              canSeeHistory={user.role === "admin"}
              canDescribe={user.role === "admin" || isClinical(user.role)}
              showCancelled={showCancelled}
            />
          </div>
        )}
        <BottomNav view={view} onView={openView} onMenu={() => setMenuOpen((o) => !o)} menuOpen={menuOpen} />
      </main>
    </div>
  );
}
