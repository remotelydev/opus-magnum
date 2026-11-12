// Large, touch-first controls for the registration form on the iPad.
import { CheckIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import type { Answer, Answers, Field } from "../../../src/intake-form.ts";
import { isVisible } from "../../../src/intake-form.ts";
import { composeDate, MONTHS, splitDate } from "./kiosk.ts";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

const control =
  "w-full rounded-xl border-2 border-input bg-surface px-4 text-[1.1rem] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none aria-invalid:border-destructive";

/** Field names change per page load so Safari never offers the previous patient's answers. */
const NONCE = Math.random().toString(36).slice(2, 8);
const noFill = (id: string) => ({ name: `f-${id}-${NONCE}`, autoComplete: "off", autoCorrect: "off", spellCheck: false });

export function StepFields({
  fields,
  answers,
  errors,
  onChange,
}: {
  fields: Field[];
  answers: Answers;
  errors: Record<string, string>;
  onChange: (id: string, value: Answer) => void;
}) {
  return (
    <div className="space-y-7">
      {fields
        .filter((f) => isVisible(f, answers))
        .map((field) => (
          <FieldBlock key={field.id} field={field} value={answers[field.id]} error={errors[field.id]} onChange={(v) => onChange(field.id, v)} />
        ))}
    </div>
  );
}

function FieldBlock({ field, value, error, onChange }: { field: Field; value: Answer | undefined; error?: string; onChange: (v: Answer) => void }) {
  const labelId = `l-${field.id}`;
  const errorId = `e-${field.id}`;
  const described = error ? errorId : field.hint ? `h-${field.id}` : undefined;
  const label = (
    <span id={labelId} className="block text-[1.05rem] font-semibold text-foreground">
      {field.label}
      {field.required && field.type !== "consent" && <span className="text-destructive"> *</span>}
    </span>
  );
  const message = (
    <>
      {field.hint && !error && (
        <p id={`h-${field.id}`} className="mt-1.5 text-[0.9rem] text-muted-foreground">
          {field.hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-[0.95rem] font-medium text-destructive">
          {error}
        </p>
      )}
    </>
  );

  if (field.type === "consent") {
    return (
      <div data-field={field.id}>
        <ConsentRow field={field} checked={value === true} invalid={!!error} described={described} onChange={onChange} />
        {message}
      </div>
    );
  }

  if (field.type === "choice" || field.type === "multi") {
    const chosen = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const toggle = (optionValue: string, exclusive?: boolean) => {
      if (field.type === "choice") return onChange(optionValue);
      if (chosen.includes(optionValue)) return onChange(chosen.filter((v) => v !== optionValue));
      const exclusives = field.options.filter((o) => o.exclusive).map((o) => o.value);
      onChange(exclusive ? [optionValue] : [...chosen.filter((v) => !exclusives.includes(v)), optionValue]);
    };
    return (
      <fieldset data-field={field.id} aria-describedby={described} aria-invalid={!!error || undefined}>
        <legend className="mb-3">{label}</legend>
        <div
          role={field.type === "choice" ? "radiogroup" : "group"}
          aria-labelledby={labelId}
          className={cx("grid gap-3", field.type === "multi" ? "sm:grid-cols-2" : field.options.length > 2 ? "grid-cols-3" : "grid-cols-2")}
        >
          {field.options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role={field.type === "choice" ? "radio" : "checkbox"}
                aria-checked={on}
                onClick={() => toggle(o.value, o.exclusive)}
                className={cx(
                  "flex min-h-14 items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-[1.05rem] transition-colors",
                  on ? "border-primary bg-primary-soft font-semibold text-primary" : "border-input bg-surface text-foreground",
                  error && !on && "border-destructive/60",
                  field.type === "choice" && "justify-center text-center",
                )}
              >
                {field.type === "multi" && <Tick on={on} />}
                {o.label}
              </button>
            );
          })}
        </div>
        {message}
      </fieldset>
    );
  }

  if (field.type === "date") {
    return (
      <div data-field={field.id} role="group" aria-labelledby={labelId} aria-describedby={described}>
        <div className="mb-2">{label}</div>
        <DateInput value={typeof value === "string" ? value : ""} invalid={!!error} onChange={onChange} id={field.id} />
        {message}
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";
  const common = {
    id: `i-${field.id}`,
    value: text,
    "aria-invalid": !!error || undefined,
    "aria-describedby": described,
    placeholder: "placeholder" in field ? field.placeholder : undefined,
    ...noFill(field.id),
  };
  return (
    <div data-field={field.id}>
      <label htmlFor={common.id} className="mb-2 block">
        {label}
      </label>
      {field.type === "textarea" ? (
        <textarea
          {...common}
          rows={3}
          maxLength={field.maxLength}
          className={cx(control, "py-3")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
          inputMode={field.type === "tel" ? "tel" : field.type === "pesel" ? "numeric" : field.type === "email" ? "email" : undefined}
          maxLength={field.type === "text" ? field.maxLength : field.type === "pesel" ? 11 : 120}
          autoCapitalize={field.type === "email" ? "none" : field.type === "text" ? "words" : undefined}
          className={cx(control, "h-14")}
          onChange={(e) => onChange(field.type === "pesel" ? e.target.value.replace(/\D/g, "") : e.target.value)}
        />
      )}
      {message}
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-md border-2",
        on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface",
      )}
      aria-hidden="true"
    >
      {on && <CheckIcon className="size-5" />}
    </span>
  );
}

function ConsentRow({
  field,
  checked,
  invalid,
  described,
  onChange,
}: {
  field: Extract<Field, { type: "consent" }>;
  checked: boolean;
  invalid: boolean;
  described?: string;
  onChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("rounded-xl border-2 bg-surface", checked ? "border-primary" : invalid ? "border-destructive/60" : "border-input")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-describedby={described}
        onClick={() => onChange(!checked)}
        className="flex w-full items-start gap-4 p-4 text-left text-[1.05rem] text-foreground"
      >
        <Tick on={checked} />
        <span>
          {field.label}
          {field.required && <span className="text-destructive"> *</span>}
        </span>
      </button>
      {field.details && (
        <div className="px-4 pb-4 pl-15">
          <button type="button" className="text-[0.95rem] font-medium text-primary underline underline-offset-4" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Zwiń" : "Przeczytaj"}
          </button>
          {open && <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{field.details}</p>}
        </div>
      )}
    </div>
  );
}

/** Day, month and year as three fields: easier for many patients than the iPad date wheel. */
function DateInput({ id, value, invalid, onChange }: { id: string; value: string; invalid: boolean; onChange: (v: string) => void }) {
  const [parts, setParts] = useState(() => splitDate(value));
  const set = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    onChange(composeDate(next.day, next.month, next.year));
  };
  return (
    <div className="grid grid-cols-[1fr_2fr_1.3fr] gap-3">
      <input
        aria-label="Dzień"
        placeholder="Dzień"
        inputMode="numeric"
        maxLength={2}
        value={parts.day}
        aria-invalid={invalid || undefined}
        className={cx(control, "h-14 text-center")}
        onChange={(e) => set({ day: e.target.value.replace(/\D/g, "") })}
        {...noFill(`${id}-d`)}
      />
      <select
        aria-label="Miesiąc"
        value={parts.month}
        aria-invalid={invalid || undefined}
        className={cx(control, "h-14", !parts.month && "text-muted-foreground")}
        onChange={(e) => set({ month: e.target.value })}
        name={`f-${id}-m-${NONCE}`}
      >
        <option value="">Miesiąc</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </select>
      <input
        aria-label="Rok"
        placeholder="Rok"
        inputMode="numeric"
        maxLength={4}
        value={parts.year}
        aria-invalid={invalid || undefined}
        className={cx(control, "h-14 text-center")}
        onChange={(e) => set({ year: e.target.value.replace(/\D/g, "") })}
        {...noFill(`${id}-y`)}
      />
    </div>
  );
}
