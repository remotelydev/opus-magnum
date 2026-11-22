import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { useCallback, useEffect, useState } from "react";
import { FORM, isVisible } from "../../../src/intake-form.ts";
import { api, type IntakeDetail, type IntakeSummary, type KioskDevice, type Site } from "../lib/api.ts";
import { formatAnswer } from "../kiosk/kiosk.ts";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

const timeFmt = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const formatBirth = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso}T12:00:00Z`)) : "—");

/** Registrations patients sent from the iPads, and the paired iPads themselves. */
export function IntakePage({ sites, onOpenPatient }: { sites: Site[]; onOpenPatient: (id: number) => void }) {
  const [status, setStatus] = useState<"new" | "accepted">("new");
  const [items, setItems] = useState<IntakeSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    api
      .intake(status)
      .then((r) => current && (setItems(r), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [status, reloadKey]);

  // New registrations show up without a reload while the list is open.
  useEffect(() => {
    if (selected !== null) return;
    const timer = setInterval(() => setReloadKey((k) => k + 1), 20_000);
    return () => clearInterval(timer);
  }, [selected]);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  if (selected !== null) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="mx-auto max-w-3xl">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected(null);
              setReloadKey((k) => k + 1);
            }}
          >
            ← Rejestracje
          </Button>
          <IntakeView key={selected} id={selected} siteName={siteName} onOpenPatient={onOpenPatient} onDone={() => setReloadKey((k) => k + 1)} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-base font-semibold">Rejestracje z tabletu</h1>
          <div className="flex overflow-hidden rounded-md border border-input" role="tablist" aria-label="Stan">
            {(["new", "accepted"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={status === s}
                onClick={() => setStatus(s)}
                className={cx("px-3 py-1 text-xs pointer-coarse:py-2", status === s ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-muted")}
              >
                {s === "new" ? "Do przyjęcia" : "Przyjęte"}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {items === null ? (
            <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {status === "new" ? "Nie ma nowych formularzy. Wypełnione na tablecie pojawią się tutaj." : "Nie ma jeszcze przyjętych formularzy."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(it.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-left hover:bg-muted sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <span className="truncate text-sm font-medium">
                      {it.lastName} {it.firstName}
                    </span>
                    <span className="text-xs text-muted-foreground max-sm:order-last max-sm:col-span-2">
                      ur. {formatBirth(it.birthDate)} · {it.phone ?? "bez telefonu"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground max-sm:hidden">
                      {siteName(it.siteId)}
                      {it.deviceName ? ` · ${it.deviceName}` : ""}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground">{timeFmt.format(new Date(it.createdAt))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Tablets siteName={siteName} />
      </div>
    </div>
  );
}

function IntakeView({
  id,
  siteName,
  onOpenPatient,
  onDone,
}: {
  id: number;
  siteName: (id: string) => string;
  onOpenPatient: (id: number) => void;
  onDone: () => void;
}) {
  const [item, setItem] = useState<IntakeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(() => {
    api
      .intakeDetail(id)
      .then(setItem)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const accept = async (patientId?: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.acceptIntake(id, patientId);
      load();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Usunąć ten formularz? Odpowiedzi pacjenta zostaną skasowane.")) return;
    setBusy(true);
    try {
      await api.deleteIntake(id);
      setDeleted(true);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (deleted) return <p className="mt-4 text-sm text-muted-foreground">Formularz usunięty.</p>;
  if (!item) return <p className={cx("mt-4 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error ?? "Ładowanie…"}</p>;

  const isNew = item.status === "new";
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">
            {item.firstName} {item.lastName}
          </h1>
          <span className="text-sm text-muted-foreground">
            {timeFmt.format(new Date(item.createdAt))} · {siteName(item.siteId)}
            {item.deviceName ? ` · ${item.deviceName}` : ""}
          </span>
        </div>
        {!isNew && item.patientId && (
          <p className="mt-2 text-sm">
            Przyjęty.{" "}
            <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => onOpenPatient(item.patientId!)}>
              Otwórz kartę pacjenta
            </button>
          </p>
        )}
      </div>

      {isNew && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Przyjmij do kartoteki</h2>
          {item.draft.medicalFlags.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Na karcie pojawią się oznaczenia: </span>
              {item.draft.medicalFlags.join(", ")}
            </p>
          )}
          {item.draft.notes.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Do uwag: </span>
              {item.draft.notes.join("; ")}
            </p>
          )}
          {item.matches.length > 0 && (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
              <p className="text-sm font-medium">Może to ktoś, kto już ma kartę:</p>
              <ul className="mt-2 space-y-2">
                {item.matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">
                      {m.lastName} {m.firstName}
                    </span>
                    <span className="text-muted-foreground">
                      ur. {formatBirth(m.birthDate)} · {m.phone ?? "bez telefonu"}
                    </span>
                    <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => accept(m.id)}>
                      Dopisz do tej karty
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Dopisanie uzupełnia puste dane kontaktowe, dodaje oznaczenia medyczne i odpowiedzi do uwag. Niczego nie nadpisuje.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => accept()}>
              Załóż nową kartę
            </Button>
            <Button variant="outline" disabled={busy} onClick={remove}>
              Usuń
            </Button>
          </div>
        </div>
      )}

      {FORM.steps.map((step) => (
        <section key={step.id} className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{step.title}</h2>
          <dl className="divide-y divide-border">
            {step.fields
              .filter((f) => isVisible(f, item.answers))
              .map((f) => (
                <div key={f.id} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="break-words">{formatAnswer(f, item.answers[f.id])}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Tablets({ siteName }: { siteName: (id: string) => string }) {
  const [devices, setDevices] = useState<KioskDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .kioskDevices()
      .then(setDevices)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const revoke = async (d: KioskDevice) => {
    if (!confirm(`Odłączyć „${d.name}”? Formularz przestanie na nim działać, dopóki ktoś z recepcji nie uruchomi go ponownie.`)) return;
    await api.revokeKioskDevice(d.id).catch((e: Error) => setError(e.message));
    load();
  };

  const url = `${location.origin}/rejestracja`;
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Tablety</h2>
      <div className="space-y-1 px-4 py-3 text-sm text-muted-foreground">
        <p>
          Na iPadzie otwórz w Safari <span className="font-mono text-foreground">{url}</span> i podaj swój login i hasło. Tablet nie zostaje zalogowany: może tylko wysyłać formularze.
        </p>
        <p>Potem „Udostępnij → Do ekranu początkowego” i włącz Dostęp nadzorowany, żeby pacjent nie wyszedł z formularza.</p>
      </div>
      {error && <p className="px-4 pb-2 text-sm text-destructive">{error}</p>}
      {devices && devices.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <span className="font-medium">{d.name}</span>
              <span className="text-muted-foreground">
                {siteName(d.siteId)} · uruchomił(a) {d.createdByName ?? "?"} · ostatnio {d.lastSeenAt ? timeFmt.format(new Date(d.lastSeenAt)) : "nigdy"}
              </span>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => revoke(d)}>
                Odłącz
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
