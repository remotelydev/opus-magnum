/** Colour theme choice. "system" follows the OS; "light"/"dark" force it with a class on <html>. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "horarium.theme";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function nextTheme(current: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

/** The tokens CSS reads `.light` / `.dark` on <html>; no class means "follow the system". */
export function applyTheme(choice: ThemeChoice, root: { classList: DOMTokenList } = document.documentElement): void {
  root.classList.toggle("light", choice === "light");
  root.classList.toggle("dark", choice === "dark");
}
