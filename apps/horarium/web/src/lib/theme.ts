/** Colour theme. Until the user picks one, the app starts in whatever the OS prefers. */
export type Theme = "light" | "dark";

export const THEME_KEY = "horarium.theme";

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** The saved choice, else the OS preference. */
export function currentTheme(): Theme {
  let saved: Theme | null = null;
  try {
    saved = parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    /* storage blocked */
  }
  if (saved) return saved;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

/** The tokens CSS reads `.light` / `.dark` on <html>. */
export function applyTheme(theme: Theme, root: { classList: DOMTokenList } = document.documentElement): void {
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}
