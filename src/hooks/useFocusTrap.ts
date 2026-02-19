import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus within a container when active. Returns focus to trigger on cleanup.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const triggerElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    triggerElementRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const isShiftTab = event.shiftKey;
      const isOnFirstElement = document.activeElement === firstElement;
      const isOnLastElement = document.activeElement === lastElement;

      if (isShiftTab && isOnFirstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!isShiftTab && isOnLastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      if (triggerElementRef.current instanceof HTMLElement) {
        triggerElementRef.current.focus();
      }
    };
  }, [active]);

  return containerRef;
}
