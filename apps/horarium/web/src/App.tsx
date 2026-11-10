import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { useEffect, useState } from "react";
import { DayView } from "./components/DayView.tsx";
import { ServicesPage } from "./components/ServicesPage.tsx";
import { Login } from "./components/Login.tsx";
import { api, ApiError, type Service, type Site, type Staff, type User } from "./lib/api.ts";
import { addDays, formatDay, todayInClinic } from "./lib/time.ts";

const SITE_KEY = "horarium.site";

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
  const [view, setView] = useState<"calendar" | "services">("calendar");

  useEffect(() => {
    if (view !== "calendar") return;
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

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <strong className="text-sm text-primary">Horarium</strong>
        <span className="-ml-2 text-xs text-muted-foreground">DentaPlus+</span>
        <nav className="mr-2 flex gap-1" aria-label="Sekcje">
          <Button variant={view === "calendar" ? "primary" : "ghost"} size="sm" onClick={() => setView("calendar")}>
            Terminarz
          </Button>
          {user.role === "admin" && (
            <Button variant={view === "services" ? "primary" : "ghost"} size="sm" onClick={() => setView("services")}>
              Usługi i cennik
            </Button>
          )}
        </nav>
        {view === "calendar" && (
          <>
            <div className="flex overflow-hidden rounded-md border border-input" role="tablist" aria-label="Placówka">
              {sites.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === site}
                  onClick={() => chooseSite(s.id)}
                  className={`px-3 py-1 text-xs ${s.id === site ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-muted"}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
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
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="ml-1 h-7 rounded-md border border-input bg-surface px-2 text-xs"
                aria-label="Wybierz dzień"
              />
            </div>
            <span className="text-sm capitalize">{formatDay(date)}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {user.name} ({user.role === "admin" ? "administrator" : user.role === "reception" ? "recepcja" : "lekarz"})
          </span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Wyloguj
          </Button>
        </div>
      </header>
      {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}
      {view === "services" ? (
        <ServicesPage />
      ) : (
        <DayView
          key={`${site}-${date}`}
          site={site}
          date={date}
          staff={staff.filter((s) => s.active && s.sites.includes(site))}
          services={services}
          canEdit={user.role !== "doctor"}
        />
      )}
    </div>
  );
}
