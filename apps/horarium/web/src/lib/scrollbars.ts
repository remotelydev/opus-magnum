/** How long a scrolled area keeps its scrollbar visible after the last scroll event. */
const VISIBLE_MS = 900;

/** Marks an area while the pointer is over it. */
export const HOVER_ATTR = "data-scrollbar-hover";
/** Marks an area for a moment after it scrolled (wheel, keyboard, touchpad or code). */
export const SCROLLING_ATTR = "data-scrolling";

function scrollable(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const style = getComputedStyle(el);
  return /auto|scroll/.test(style.overflowY + style.overflowX);
}

/**
 * Shows the thin scrollbars (styles.css) only where they are useful: in the areas under the pointer
 * and in whatever is being scrolled, even when the pointer is elsewhere. Both are marked with
 * attributes instead of CSS `:hover`, because Chrome and Edge do not repaint a scrollbar when only
 * its element's hover state changes. One set of listeners for the whole page.
 */
export function revealScrollbars(doc: Document = document): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  let hovered: Element[] = [];

  const onScroll = (event: Event) => {
    const el = event.target instanceof Element ? event.target : doc.scrollingElement;
    if (!el) return;
    clearTimeout(timers.get(el));
    if (!el.hasAttribute(SCROLLING_ATTR)) el.setAttribute(SCROLLING_ATTR, "");
    timers.set(
      el,
      setTimeout(() => {
        el.removeAttribute(SCROLLING_ATTR);
        timers.delete(el);
      }, VISIBLE_MS),
    );
  };

  const setHovered = (next: Element[]) => {
    for (const el of hovered) if (!next.includes(el)) el.removeAttribute(HOVER_ATTR);
    for (const el of next) if (!el.hasAttribute(HOVER_ATTR)) el.setAttribute(HOVER_ATTR, "");
    hovered = next;
  };
  const onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const next: Element[] = [];
    for (let el = event.target instanceof Element ? event.target : null; el; el = el.parentElement) {
      if (scrollable(el)) next.push(el);
    }
    setHovered(next);
  };
  const onLeave = (event: PointerEvent) => {
    // relatedTarget is empty when the pointer leaves the window.
    if (!event.relatedTarget) setHovered([]);
  };

  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  doc.addEventListener("pointerover", onOver, { passive: true });
  doc.addEventListener("pointerout", onLeave, { passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onLeave);
    for (const [el, timer] of timers) {
      clearTimeout(timer);
      el.removeAttribute(SCROLLING_ATTR);
    }
    timers.clear();
    setHovered([]);
  };
}
