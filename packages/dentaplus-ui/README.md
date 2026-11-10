# @opus-magnum/dentaplus-ui

DentaPlus+ design system: design tokens and React components for the clinic apps (`apps/horarium`).

- `src/tokens/tokens.ts`: the source of truth. Palette, semantic colours (light and dark), appointment status colours, radius, fonts, calendar geometry.
- `src/tokens/tokens.css`: generated CSS variables (`--dp-*`) and the Tailwind v4 theme mapping. Do not edit by hand; regenerate after changing `tokens.ts`:

```bash
pnpm --filter @opus-magnum/dentaplus-ui tokens
```

A test fails if the committed CSS is stale.

- `src/components/`: `Button`, `Input`, `Select`, `Label`, `Modal`, `StatusBadge` and `STATUS_CLASSES` for appointment statuses.

Use in an app:

```css
@import "@opus-magnum/dentaplus-ui/styles.css";
@source "./**/*.{ts,tsx}";
```

```tsx
import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { calendar } from "@opus-magnum/dentaplus-ui/tokens";
```

Separate from `@opus-magnum/ui`, which keeps its own editorial style.
