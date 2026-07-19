import { useEffect, type RefObject } from "react";

export function useModalFocus(container: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const dialog = container.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
    const backgroundControls = Array.from(dialog.closest(".game-shell")?.querySelectorAll<HTMLElement>(selector) ?? [])
      .filter((element) => !dialog.contains(element));
    const previouslyInert = backgroundControls.filter((element) => element.inert);
    backgroundControls.forEach((element) => { element.inert = true; });
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable[0] ?? dialog).focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const available = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      if (!available.length) { event.preventDefault(); dialog.focus(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => {
      dialog.removeEventListener("keydown", trapFocus);
      backgroundControls.forEach((element) => { element.inert = previouslyInert.includes(element); });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, container]);
}
