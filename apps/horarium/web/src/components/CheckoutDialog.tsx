import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input } from "@opus-magnum/dentaplus-ui/components/field";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, PAYMENT_METHOD_LABEL, type Appointment, type PaymentMethod, type Service } from "../lib/api.ts";
import { formatMoney, suggestedPrice } from "../lib/money.ts";

interface Line {
  key: number;
  serviceId: number;
  name: string;
  price: number;
}

interface Props {
  appointment: Appointment;
  services: Service[];
  onDone: (message: string) => void;
  onCancel: () => void;
}

/**
 * Closing a visit: what was done (from the price list) and how the patient paid. A price reads as plain
 * text, as on a receipt; clicking it lets reception change it. Nothing on screen says it can be changed,
 * so a patient looking at the monitor does not see room to haggle.
 */
export function CheckoutDialog({ appointment: a, services, onDone, onCancel }: Props) {
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useMemo(() => services.filter((s) => s.active), [services]);

  const line = (s: Pick<Service, "id" | "name">, price: number): Line => ({ key: nextKey.current++, serviceId: s.id, name: s.name, price });

  useEffect(() => {
    // Closed before: show what was entered. Otherwise start from the booked service.
    api
      .checkout(a.id)
      .then((saved) => {
        if (saved.items.length) {
          setLines(saved.items.filter((i) => i.serviceId !== null).map((i) => line({ id: i.serviceId!, name: i.name }, i.price)));
          if (saved.method === "cash" || saved.method === "card") setMethod(saved.method);
          return;
        }
        const booked = services.find((s) => s.id === a.serviceId);
        setLines(booked ? [line(booked, suggestedPrice(booked))] : []);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLines([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return active.filter((s) => `${s.category} ${s.name}`.toLowerCase().includes(q)).slice(0, 8);
  }, [active, query]);

  const add = (s: Service) => {
    setLines((ls) => [...(ls ?? []), line(s, suggestedPrice(s))]);
    setQuery("");
  };
  const total = (lines ?? []).reduce((sum, l) => sum + l.price, 0);

  const save = async () => {
    if (!lines?.length) return setError("Dodaj co najmniej jedną usługę z cennika.");
    if (!method) return setError("Wybierz formę płatności.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveCheckout(
        a.id,
        lines.map((l) => ({ serviceId: l.serviceId, price: l.price })),
        method,
      );
      onDone(`Wizyta zakończona: ${formatMoney(res.total)}, ${PAYMENT_METHOD_LABEL[method].toLowerCase()}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Zakończ wizytę" onClose={onCancel}>
      <div className="space-y-4 text-sm">
        <p className="font-medium">{a.patientName ?? a.title}</p>

        {lines === null ? (
          <p className="text-muted-foreground">Ładowanie…</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Wykonane usługi">
            {lines.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nie dodano usług.</li>}
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">{l.name}</span>
                {editing === l.key ? (
                  <PriceInput
                    value={l.price}
                    onDone={(price) => {
                      setLines((ls) => ls!.map((x) => (x.key === l.key ? { ...x, price } : x)));
                      setEditing(null);
                    }}
                  />
                ) : (
                  <span className="tabular-nums" onClick={() => setEditing(l.key)} data-testid="price">
                    {formatMoney(l.price)}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Usuń ${l.name}`}
                  onClick={() => setLines((ls) => ls!.filter((x) => x.key !== l.key))}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  ✕
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between px-3 py-2 font-medium">
              <span>Razem</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </li>
          </ul>
        )}

        <div className="relative">
          <Input
            aria-label="Dodaj usługę z cennika"
            placeholder="Dodaj usługę z cennika…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                add(matches[0]);
              }
            }}
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg" role="listbox">
              {matches.map((s) => (
                <li key={s.id} role="option" aria-selected={false}>
                  <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => add(s)}>
                    <span>
                      {s.name} <span className="text-xs text-muted-foreground">{s.category}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">{formatMoney(suggestedPrice(s))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Forma płatności</legend>
          <div className="flex gap-2">
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <Button key={m} type="button" variant={method === m ? "primary" : "outline"} aria-pressed={method === m} onClick={() => setMethod(m)}>
                {PAYMENT_METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={busy || lines === null} onClick={save}>
            Zakończ wizytę
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Anuluj
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Opened by a click on the price; Enter or leaving the field keeps the new amount, Escape the old one. */
function PriceInput({ value, onDone }: { value: number; onDone: (price: number) => void }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  const commit = () => {
    const n = Number(text.replace(/\s/g, "").replace(",", "."));
    onDone(Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : value);
  };
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="Cena"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone(value);
        }
      }}
      className="w-24 rounded border border-input bg-surface px-1 text-right tabular-nums"
    />
  );
}
