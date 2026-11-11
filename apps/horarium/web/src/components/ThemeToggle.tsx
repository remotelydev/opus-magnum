import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import { applyTheme, nextTheme, readTheme, saveTheme, type ThemeChoice } from "../lib/theme.ts";

const LABELS: Record<ThemeChoice, string> = {
  system: "Motyw: jak w systemie",
  light: "Motyw: jasny",
  dark: "Motyw: ciemny",
};

const ICONS = { system: ComputerDesktopIcon, light: SunIcon, dark: MoonIcon } as const;

/** One button that cycles system → light → dark. The choice is kept in localStorage. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const Icon = ICONS[theme];
  const next = nextTheme(theme);

  const change = () => {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={change}
      aria-label={`${LABELS[theme]}. Kliknij: ${LABELS[next].replace("Motyw: ", "")}`}
      title={`${LABELS[theme]} (kliknij, aby zmienić)`}
    >
      <Icon />
    </Button>
  );
}
