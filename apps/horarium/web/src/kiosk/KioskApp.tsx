// /rejestracja: the patient registration form on the clinic iPad.
//
// No staff login on the tablet: it is paired once and then only shows this form. Nothing here
// leads anywhere else (no links, the browser's back gesture is swallowed), every patient starts
// from a clean form, and an abandoned form is cleared after a short idle time. For a fully locked
// iPad, start Guided Access (Dostęp nadzorowany) on top: see apps/horarium/docs/registration-ipad.md.
import { ArrowLeftIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Answer, Answers, IntakeForm } from "../../../src/intake-form.ts";
import { isVisible, validateAnswers } from "../../../src/intake-form.ts";
import { api, ApiError, type KioskState, type Site } from "../lib/api.ts";
import { applyTheme, type Theme } from "../lib/theme.ts";
import { StepFields } from "./IntakeFields.tsx";
import {
  BASE_FONT_PX,
  firstErrorStep,
  FONT_STEPS,
  formatAnswer,
  IDLE_AFTER_S,
  IDLE_COUNTDOWN_S,
  stepFont,
  THANKS_RESET_S,
} from "./kiosk.ts";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

/** Where the patient is: the start screen, a step of the form, the check screen, or done. */
type Stage = { kind: "welcome" } | { kind: "step"; index: number } | { kind: "review" } | { kind: "thanks" };

const bigButton =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-7 text-[1.1rem] font-semibold transition-colors disabled:opacity-50";
const primaryButton = `${bigButton} bg-primary text-primary-foreground active:bg-primary/85`;
const outlineButton = `${bigButton} border-2 border-input bg-surface text-foreground active:bg-muted`;

export function KioskApp() {
  const [state, setState] = useState<KioskState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .kioskState()
      .then((s) => {
        setState(s);
        setLoadError(null);
      })
      .catch(() => setLoadError("Brak połączenia z serwerem kliniki. Spróbuj ponownie za chwilę."));
  }, []);

  useEffect(() => {
    document.title = "Rejestracja · DentaPlus+";
    document.documentElement.classList.add("kiosk");
    load();
  }, [load]);

  // Swallow the browser's back gesture and button: the tablet stays on this page.
  useEffect(() => {
    history.pushState({ kiosk: true }, "", location.href);
    const stay = () => history.pushState({ kiosk: true }, "", location.href);
    window.addEventListener("popstate", stay);
    return () => window.removeEventListener("popstate", stay);
  }, []);

  if (loadError && !state) {
    return (
      <Centered>
        <p className="text-[1.1rem] text-muted-foreground">{loadError}</p>
        <button type="button" className={cx(outlineButton, "mt-6")} onClick={load}>
          Spróbuj ponownie
        </button>
      </Centered>
    );
  }
  if (!state) return <Centered><p className="text-muted-foreground">Ładowanie…</p></Centered>;
  if (!state.paired) return <PairScreen sites={state.sites} onPaired={load} />;
  return <Registration form={state.form} siteName={state.device.siteName} onDeviceLost={load} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-full flex-col items-center justify-center bg-background p-6 text-center">{children}</main>;
}

// --- the form ------------------------------------------------------------------------------

function Registration({ form, siteName, onDeviceLost }: { form: IntakeForm; siteName: string; onDeviceLost: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: "welcome" });
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [font, setFont] = useState(0);
  const [theme, setTheme] = useState<Theme>("light");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [service, setService] = useState(false);
  // Bumped on every reset, so the field components (and their typed text) start over too.
  const [round, setRound] = useState(0);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_PX * FONT_STEPS[font]}px`;
  }, [font]);
  useEffect(() => applyTheme(theme), [theme]);

  /** Back to the start screen with nothing left from the previous patient. */
  const reset = useCallback(() => {
    setAnswers({});
    setErrors({});
    setSendError(null);
    setFont(0);
    setTheme("light");
    setStage({ kind: "welcome" });
    setRound((r) => r + 1);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  const idle = useIdle(stage.kind === "step" || stage.kind === "review", reset);

  useEffect(() => {
    if (stage.kind !== "thanks") return;
    const timer = setTimeout(reset, THANKS_RESET_S * 1000);
    return () => clearTimeout(timer);
  }, [stage, reset]);

  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [stage]);

  const showFirstError = (errs: Record<string, string>) => {
    requestAnimationFrame(() => {
      const id = Object.keys(errs)[0];
      document.querySelector(`[data-field="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const change = (id: string, value: Answer) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    if (errors[id]) setErrors(({ [id]: _, ...rest }) => rest);
  };

  const next = () => {
    if (stage.kind !== "step") return;
    const { errors: errs } = validateAnswers(form, answers, { step: stage.index });
    setErrors(errs);
    if (Object.keys(errs).length) return showFirstError(errs);
    setStage(stage.index + 1 < form.steps.length ? { kind: "step", index: stage.index + 1 } : { kind: "review" });
  };

  const back = () => {
    setErrors({});
    if (stage.kind === "review") setStage({ kind: "step", index: form.steps.length - 1 });
    else if (stage.kind === "step") setStage(stage.index === 0 ? { kind: "welcome" } : { kind: "step", index: stage.index - 1 });
  };

  const submit = async () => {
    const { values, errors: errs } = validateAnswers(form, answers);
    const step = firstErrorStep(form, errs);
    if (step !== null) {
      setErrors(errs);
      setStage({ kind: "step", index: step });
      return showFirstError(errs);
    }
    setSending(true);
    setSendError(null);
    try {
      await api.kioskSubmit(values);
      setAnswers({});
      setStage({ kind: "thanks" });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const at = firstErrorStep(form, err.fields);
        setErrors(err.fields);
        if (at !== null) setStage({ kind: "step", index: at });
        showFirstError(err.fields);
      } else if (err instanceof ApiError && err.status === 401) {
        onDeviceLost();
      } else {
        setSendError(err instanceof ApiError ? err.message : "Nie udało się wysłać. Sprawdź połączenie i spróbuj ponownie.");
      }
    } finally {
      setSending(false);
    }
  };

  const total = form.steps.length + 1;
  const position = stage.kind === "step" ? stage.index + 1 : stage.kind === "review" ? total : 0;

  return (
    <div className="kiosk-root flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <ServiceHandle onOpen={() => setService(true)} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[1rem] font-semibold">DentaPlus+ · {siteName}</div>
          {position > 0 && (
            <div className="text-[0.85rem] text-muted-foreground">
              Krok {position} z {total}
            </div>
          )}
        </div>
        <Controls font={font} onFont={setFont} theme={theme} onTheme={setTheme} />
      </header>
      {position > 0 && (
        <div className="h-1.5 shrink-0 bg-muted" aria-hidden="true">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${(position / total) * 100}%` }} />
        </div>
      )}

      <div ref={content} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" key={round}>
        <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
          {stage.kind === "welcome" && (
            <section className="flex min-h-[60vh] flex-col items-center justify-center text-center">
              <h1 className="text-[2rem] font-bold text-foreground">Witamy w DentaPlus+</h1>
              <p className="mt-3 max-w-md text-[1.15rem] text-muted-foreground">
                Prosimy o wypełnienie krótkiego formularza. Zajmie to około 3 minut.
              </p>
              <p className="mt-2 max-w-md text-[0.95rem] text-muted-foreground">
                Rozmiar tekstu i tryb ciemny zmienisz przyciskami w prawym górnym rogu.
              </p>
              <button type="button" className={cx(primaryButton, "mt-10 min-w-64 text-[1.25rem]")} onClick={() => setStage({ kind: "step", index: 0 })}>
                Rozpocznij
              </button>
            </section>
          )}

          {stage.kind === "step" && (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                next();
              }}
              noValidate
              autoComplete="off"
            >
              <h1 className="text-[1.6rem] font-bold">{form.steps[stage.index].title}</h1>
              {form.steps[stage.index].intro && <p className="mt-2 text-[1rem] text-muted-foreground">{form.steps[stage.index].intro}</p>}
              <div className="mt-7">
                <StepFields fields={form.steps[stage.index].fields} answers={answers} errors={errors} onChange={change} />
              </div>
              {/* Enter on the iPad keyboard moves on, like the button below. */}
              <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
            </form>
          )}

          {stage.kind === "review" && (
            <section>
              <h1 className="text-[1.6rem] font-bold">Sprawdź dane</h1>
              <p className="mt-2 text-[1rem] text-muted-foreground">Jeśli coś się nie zgadza, wróć i popraw.</p>
              <div className="mt-6 space-y-5">
                {form.steps.map((step, i) => (
                  <div key={step.id} className="rounded-xl border border-border bg-surface">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                      <h2 className="text-[1.1rem] font-semibold">{step.title}</h2>
                      <button type="button" className="min-h-11 px-2 text-[1rem] font-medium text-primary" onClick={() => setStage({ kind: "step", index: i })}>
                        Popraw
                      </button>
                    </div>
                    <dl className="divide-y divide-border">
                      {step.fields
                        .filter((f) => isVisible(f, answers) && f.type !== "consent")
                        .map((f) => (
                          <div key={f.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                            <dt className="text-[0.9rem] text-muted-foreground">{f.label}</dt>
                            <dd className="text-[1rem] break-words">{formatAnswer(f, answers[f.id])}</dd>
                          </div>
                        ))}
                      {step.fields
                        .filter((f) => f.type === "consent" && answers[f.id] === true)
                        .map((f) => (
                          <div key={f.id} className="flex gap-2 px-4 py-2.5 text-[0.95rem]">
                            <span className="text-primary" aria-hidden="true">✓</span>
                            {f.label}
                          </div>
                        ))}
                    </dl>
                  </div>
                ))}
              </div>
              {sendError && (
                <p role="alert" className="mt-5 text-[1rem] font-medium text-destructive">
                  {sendError}
                </p>
              )}
            </section>
          )}

          {stage.kind === "thanks" && (
            <section className="flex min-h-[60vh] flex-col items-center justify-center text-center" aria-live="polite">
              <CheckCircleIcon className="size-20 text-primary" aria-hidden="true" />
              <h1 className="mt-4 text-[2rem] font-bold">Dziękujemy!</h1>
              <p className="mt-3 max-w-md text-[1.15rem] text-muted-foreground">
                Formularz został przekazany do recepcji. Prosimy oddać tablet w recepcji.
              </p>
              <button type="button" className={cx(outlineButton, "mt-10")} onClick={reset}>
                Zakończ
              </button>
            </section>
          )}
        </div>
      </div>

      {(stage.kind === "step" || stage.kind === "review") && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          <button type="button" className={outlineButton} onClick={back}>
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
            Wstecz
          </button>
          <div className="flex-1" />
          {stage.kind === "step" ? (
            <button type="button" className={cx(primaryButton, "min-w-44")} onClick={next}>
              Dalej
            </button>
          ) : (
            <button type="button" className={cx(primaryButton, "min-w-44")} onClick={submit} disabled={sending}>
              {sending ? "Wysyłanie…" : "Wyślij formularz"}
            </button>
          )}
        </footer>
      )}

      {idle.asking && <IdlePrompt seconds={idle.seconds} onStay={idle.stay} />}
      {service && <ServicePanel onClose={() => setService(false)} onUnpaired={onDeviceLost} />}
    </div>
  );
}

/** Text size and dark mode: what the patient may change. Both go back to default for the next patient. */
function Controls({ font, onFont, theme, onTheme }: { font: number; onFont: (i: number) => void; theme: Theme; onTheme: (t: Theme) => void }) {
  const box = "flex size-12 items-center justify-center rounded-xl border-2 border-input bg-surface text-foreground active:bg-muted disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl" role="group" aria-label="Rozmiar tekstu">
        <button type="button" className={box} onClick={() => onFont(stepFont(font, -1))} disabled={font === 0} aria-label="Mniejszy tekst">
          <span className="text-[0.9rem] font-bold">A−</span>
        </button>
        <button type="button" className={box} onClick={() => onFont(stepFont(font, 1))} disabled={font === FONT_STEPS.length - 1} aria-label="Większy tekst">
          <span className="text-[1.2rem] font-bold">A+</span>
        </button>
      </div>
      <button
        type="button"
        className={box}
        onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
        aria-label={theme === "dark" ? "Tryb jasny" : "Tryb ciemny"}
        aria-pressed={theme === "dark"}
      >
        {theme === "dark" ? <SunIcon className="size-6" /> : <MoonIcon className="size-6" />}
      </button>
    </div>
  );
}

// --- idle reset ----------------------------------------------------------------------------

/** After IDLE_AFTER_S without a touch, asks whether the patient is still there; then clears the form. */
function useIdle(active: boolean, onTimeout: () => void) {
  const [asking, setAsking] = useState(false);
  const [seconds, setSeconds] = useState(IDLE_COUNTDOWN_S);
  const last = useRef(Date.now());

  useEffect(() => {
    if (!active) {
      setAsking(false);
      return;
    }
    last.current = Date.now();
    const touch = () => {
      if (!asking) last.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "input", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }));
    const timer = setInterval(() => {
      const idleFor = (Date.now() - last.current) / 1000;
      if (idleFor < IDLE_AFTER_S) return;
      const left = Math.ceil(IDLE_AFTER_S + IDLE_COUNTDOWN_S - idleFor);
      if (left <= 0) {
        setAsking(false);
        onTimeout();
      } else {
        setAsking(true);
        setSeconds(left);
      }
    }, 500);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      clearInterval(timer);
    };
  }, [active, asking, onTimeout]);

  const stay = () => {
    last.current = Date.now();
    setAsking(false);
  };
  return { asking, seconds, stay };
}

function IdlePrompt({ seconds, onStay }: { seconds: number; onStay: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center shadow-xl">
        <h2 id="idle-title" className="text-[1.5rem] font-bold">
          Czy nadal wypełniasz formularz?
        </h2>
        <p className="mt-3 text-[1.05rem] text-muted-foreground">
          Za {seconds} s formularz zostanie wyczyszczony, żeby następna osoba nie zobaczyła Twoich danych.
        </p>
        <button type="button" className={cx(primaryButton, "mt-7 w-full")} onClick={onStay}>
          Tak, kontynuuję
        </button>
      </div>
    </div>
  );
}

// --- staff: pairing and the hidden service panel -------------------------------------------

/** The clinic mark. Held for 3 seconds it opens the staff panel; a tap does nothing. */
function ServiceHandle({ onOpen }: { onOpen: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div
      className="shrink-0 select-none"
      onPointerDown={() => {
        cancel();
        timer.current = setTimeout(onOpen, 3000);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" className="size-10">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M10 9v14M22 9v14M10 16h12" className="stroke-primary-foreground" strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

function StaffLogin({
  submitLabel,
  busyLabel,
  extra,
  onSubmit,
}: {
  submitLabel: string;
  busyLabel: string;
  extra?: ReactNode;
  onSubmit: (login: string, password: string) => Promise<void>;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = "h-12 w-full rounded-lg border-2 border-input bg-surface px-3 text-[1rem] focus:border-primary focus:outline-none";
  return (
    <form
      className="space-y-4 text-left"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(login, password);
        } catch (err) {
          setError((err as Error).message);
          setPassword("");
        } finally {
          setBusy(false);
        }
      }}
    >
      {extra}
      <label className="block space-y-1">
        <span className="text-[0.9rem] font-medium text-muted-foreground">Login pracownika</span>
        <input className={field} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" />
      </label>
      <label className="block space-y-1">
        <span className="text-[0.9rem] font-medium text-muted-foreground">Hasło</span>
        <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </label>
      {error && (
        <p role="alert" className="text-[0.95rem] text-destructive">
          {error}
        </p>
      )}
      <button type="submit" className={cx(primaryButton, "w-full")} disabled={busy || !login || !password}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}

function PairScreen({ sites, onPaired }: { sites: Site[]; onPaired: () => void }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [name, setName] = useState("iPad poczekalnia");
  const field = "h-12 w-full rounded-lg border-2 border-input bg-surface px-3 text-[1rem] focus:border-primary focus:outline-none";
  return (
    <main className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-sm">
        <h1 className="text-[1.4rem] font-bold">Uruchom tablet rejestracyjny</h1>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">
          Ten tablet nie jest jeszcze połączony z Horarium. Pracownik recepcji podaje swój login i hasło. Tablet nie zostaje zalogowany: będzie mógł tylko wysyłać formularze pacjentów.
        </p>
        <div className="mt-6">
          <StaffLogin
            submitLabel="Uruchom formularz"
            busyLabel="Uruchamianie…"
            extra={
              <>
                <label className="block space-y-1">
                  <span className="text-[0.9rem] font-medium text-muted-foreground">Placówka</span>
                  <select className={field} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[0.9rem] font-medium text-muted-foreground">Nazwa tabletu</span>
                  <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
                </label>
              </>
            }
            onSubmit={async (login, password) => {
              await api.kioskPair({ login, password, siteId, name: name.trim() || "iPad" });
              onPaired();
            }}
          />
        </div>
      </div>
    </main>
  );
}

function ServicePanel({ onClose, onUnpaired }: { onClose: () => void; onUnpaired: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true" aria-labelledby="service-title">
      <div className="w-full max-w-md rounded-2xl bg-surface p-7 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="service-title" className="text-[1.3rem] font-bold">
            Obsługa tabletu
          </h2>
          <button type="button" onClick={onClose} className="-mt-1 -mr-2 flex size-11 items-center justify-center rounded-lg text-muted-foreground" aria-label="Zamknij">
            ✕
          </button>
        </div>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">
          Odłączenie wyłącza formularz na tym tablecie. Żeby wyjść z blokady iPada, kliknij trzy razy przycisk boczny (Dostęp nadzorowany).
        </p>
        <div className="mt-5">
          <StaffLogin
            submitLabel="Odłącz tablet"
            busyLabel="Odłączanie…"
            onSubmit={async (login, password) => {
              await api.kioskUnpair(login, password);
              onClose();
              onUnpaired();
            }}
          />
        </div>
      </div>
    </div>
  );
}
