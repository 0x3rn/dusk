"use client";

import { useEffect } from "react";

/**
 * ActiveScrollManager detects active scrolling across the document and any
 * nested scrollable containers (modals, tables, drawers). It applies a
 * `data-scrolling="true"` attribute while scrolling and removes it 800ms after
 * scrolling ceases, allowing CSS to hide scrollbars when inactive.
 */
export function ActiveScrollManager() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activeElements = new Set<Element>();

    const triggerActiveScroll = (e: Event) => {
      const root = document.documentElement;
      root.setAttribute("data-scrolling", "true");

      const target = e.target;
      if (target instanceof Element && target !== root) {
        target.setAttribute("data-scrolling", "true");
        activeElements.add(target);
      }

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        root.removeAttribute("data-scrolling");
        activeElements.forEach((el) => {
          el.removeAttribute("data-scrolling");
        });
        activeElements.clear();
      }, 800);
    };

    window.addEventListener("scroll", triggerActiveScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", triggerActiveScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("touchmove", triggerActiveScroll, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", triggerActiveScroll, {
        capture: true,
      });
      window.removeEventListener("wheel", triggerActiveScroll, {
        capture: true,
      });
      window.removeEventListener("touchmove", triggerActiveScroll, {
        capture: true,
      });

      if (timer) {
        clearTimeout(timer);
      }
      document.documentElement.removeAttribute("data-scrolling");
      activeElements.forEach((el) => {
        el.removeAttribute("data-scrolling");
      });
      activeElements.clear();
    };
  }, []);

  return null;
}
