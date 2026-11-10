import { calendar, color, font, radius } from "./tokens.ts";

const HEADER = "/* Generated from tokens.ts by scripts/build-tokens.ts. Do not edit by hand. */\n";

function vars(theme: "light" | "dark", indent: string): string {
  return Object.entries(color)
    .map(([name, pair]) => `${indent}--dp-${name}: ${pair[theme]};`)
    .join("\n");
}

/** CSS variables (light, dark via media query and `.dark`) plus a Tailwind v4 theme mapping. */
export function renderTokensCss(): string {
  const theme = [
    ...Object.keys(color).map((name) => `  --color-${name}: var(--dp-${name});`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v};`),
    `  --font-sans: ${font.sans};`,
    `  --font-mono: ${font.mono};`,
  ].join("\n");

  const geometry = [
    `  --dp-calendar-px-per-minute: ${calendar.pxPerMinute};`,
    `  --dp-calendar-slot-minutes: ${calendar.slotMinutes};`,
    `  --dp-calendar-column-min-width: ${calendar.columnMinWidth};`,
  ].join("\n");

  return `${HEADER}
:root {
${vars("light", "  ")}
${geometry}
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not(.light) {
${vars("dark", "    ")}
    color-scheme: dark;
  }
}

:root.dark {
${vars("dark", "  ")}
  color-scheme: dark;
}

@theme inline {
${theme}
}
`;
}
