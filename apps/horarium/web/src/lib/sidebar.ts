/** Whether the left panel is collapsed to icons. Remembered per browser. */
export const SIDEBAR_KEY = "horarium.sidebar";

/** Below this width the panel starts collapsed until the user chooses otherwise. */
export const NARROW_SCREEN_PX = 1280;

export function parseCollapsed(value: string | null | undefined): boolean | null {
  return value === "collapsed" ? true : value === "expanded" ? false : null;
}

/** The saved choice, else collapsed only on narrow screens. */
export function initialCollapsed(saved: string | null | undefined, screenWidth: number): boolean {
  return parseCollapsed(saved) ?? screenWidth < NARROW_SCREEN_PX;
}

export function readCollapsed(): boolean {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SIDEBAR_KEY);
  } catch {
    /* storage blocked */
  }
  return initialCollapsed(saved, typeof window === "undefined" ? Infinity : window.innerWidth);
}

export function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    /* private mode: the choice lasts until reload */
  }
}
