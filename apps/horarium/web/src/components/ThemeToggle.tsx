import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { MoonIcon, SunIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import { applyTheme, currentTheme, oppositeTheme, saveTheme, type Theme } from "../lib/theme.ts";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next = oppositeTheme(theme);
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };
  return { theme, toggle, label: theme === "dark" ? "Włącz jasny motyw" : "Włącz ciemny motyw" };
}

/** Shows the current theme's icon; a click switches to the other theme and remembers it. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle, label } = useTheme();
  const Icon = theme === "dark" ? MoonIcon : SunIcon;
  return (
    <Button variant="ghost" size="icon" className={className} onClick={toggle} aria-label={label} title={label}>
      <Icon />
    </Button>
  );
}
