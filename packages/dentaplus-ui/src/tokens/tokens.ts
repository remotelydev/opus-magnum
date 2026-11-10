// DentaPlus+ design tokens: the single source of truth.
// `pnpm --filter @opus-magnum/dentaplus-ui tokens` writes tokens.css from this file;
// a test fails if the committed CSS is out of date.

export type Theme = "light" | "dark";
type Pair = Record<Theme, string>;

/** Raw palette. Components never use these directly, only the semantic tokens below. */
export const palette = {
  teal50: "oklch(0.98 0.014 185)",
  teal100: "oklch(0.953 0.035 185)",
  teal500: "oklch(0.6 0.105 185)",
  teal600: "oklch(0.52 0.095 186)",
  teal700: "oklch(0.44 0.08 187)",
  teal900: "oklch(0.3 0.05 190)",
  slate50: "oklch(0.984 0.003 248)",
  slate100: "oklch(0.968 0.007 248)",
  slate200: "oklch(0.929 0.013 255)",
  slate300: "oklch(0.869 0.022 252)",
  slate400: "oklch(0.704 0.04 257)",
  slate500: "oklch(0.554 0.046 257)",
  slate700: "oklch(0.372 0.044 257)",
  slate800: "oklch(0.279 0.041 260)",
  slate900: "oklch(0.208 0.042 265)",
  slate950: "oklch(0.129 0.042 265)",
  red500: "oklch(0.637 0.237 25)",
  red600: "oklch(0.577 0.245 27)",
  amber100: "oklch(0.962 0.059 95)",
  amber600: "oklch(0.666 0.179 58)",
  amber900: "oklch(0.414 0.112 46)",
  sky100: "oklch(0.951 0.026 237)",
  sky600: "oklch(0.588 0.158 242)",
  sky950: "oklch(0.293 0.066 243)",
  green100: "oklch(0.962 0.044 157)",
  green600: "oklch(0.596 0.145 163)",
  green950: "oklch(0.262 0.051 173)",
} as const;

const p = palette;

/** Semantic colours, by theme. Name -> CSS variable `--dp-<name>` and Tailwind colour `<name>`. */
export const color: Record<string, Pair> = {
  background: { light: p.slate50, dark: p.slate950 },
  surface: { light: "oklch(1 0 0)", dark: p.slate900 },
  foreground: { light: p.slate900, dark: p.slate100 },
  muted: { light: p.slate100, dark: p.slate800 },
  "muted-foreground": { light: p.slate500, dark: p.slate400 },
  border: { light: p.slate200, dark: p.slate700 },
  input: { light: p.slate300, dark: p.slate700 },
  ring: { light: p.teal500, dark: p.teal500 },
  primary: { light: p.teal600, dark: p.teal500 },
  "primary-foreground": { light: "oklch(1 0 0)", dark: p.slate950 },
  "primary-soft": { light: p.teal50, dark: p.teal900 },
  destructive: { light: p.red600, dark: p.red500 },
  "destructive-foreground": { light: "oklch(1 0 0)", dark: "oklch(1 0 0)" },
  warning: { light: p.amber600, dark: p.amber600 },
  // Calendar: off-hours background and working-hours background.
  "calendar-off": { light: p.slate100, dark: p.slate950 },
  "calendar-on": { light: "oklch(1 0 0)", dark: p.slate900 },
  // Appointment statuses: background, accent (left border), text.
  "status-booked": { light: p.sky100, dark: p.sky950 },
  "status-booked-accent": { light: p.sky600, dark: p.sky600 },
  "status-booked-foreground": { light: p.sky950, dark: p.sky100 },
  "status-confirmed": { light: p.green100, dark: p.green950 },
  "status-confirmed-accent": { light: p.green600, dark: p.green600 },
  "status-confirmed-foreground": { light: p.green950, dark: p.green100 },
  "status-done": { light: p.slate100, dark: p.slate800 },
  "status-done-accent": { light: p.slate500, dark: p.slate500 },
  "status-done-foreground": { light: p.slate700, dark: p.slate300 },
  "status-no-show": { light: p.amber100, dark: p.amber900 },
  "status-no-show-accent": { light: p.amber600, dark: p.amber600 },
  "status-no-show-foreground": { light: p.amber900, dark: p.amber100 },
  "status-cancelled": { light: "transparent", dark: "transparent" },
  "status-cancelled-accent": { light: p.slate400, dark: p.slate500 },
  "status-cancelled-foreground": { light: p.slate500, dark: p.slate400 },
};

export const radius = { sm: "0.25rem", md: "0.375rem", lg: "0.5rem" } as const;

export const font = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Calendar geometry shared by the day and week views. */
export const calendar = {
  pxPerMinute: 1.6,
  slotMinutes: 15,
  dayStartMinutes: 7 * 60,
  dayEndMinutes: 21 * 60,
  columnMinWidth: "10rem",
} as const;

export type AppointmentStatusToken = "booked" | "confirmed" | "done" | "no_show" | "cancelled";

/** Token name prefix for an appointment status (`no_show` -> `status-no-show`). */
export const statusToken = (status: AppointmentStatusToken) => `status-${status.replace("_", "-")}`;
