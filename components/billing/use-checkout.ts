"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REGISTER_FOR_CHECKOUT_PATH,
  DEFAULT_AFTER_SIGN_IN_PATH,
  startCheckout,
} from "@/lib/billing/checkout-client";

/**
 * Button state for "Buy lifetime access". Ignores a second click while one is running, and
 * never navigates away when checkout fails: it exposes `error` so the page can show it.
 */
export function useCheckout() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: two clicks in the same frame must not both start a checkout.
  const running = useRef(false);

  // Coming back with the browser's Back button can restore this page frozen in "pending".
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        running.current = false;
        setPending(false);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);

    const result = await startCheckout();
    switch (result.kind) {
      case "redirect":
        // Stay "pending" while the browser leaves for the payment page.
        window.location.assign(result.url);
        return;
      case "needs-account":
        window.location.assign(REGISTER_FOR_CHECKOUT_PATH);
        return;
      case "already-purchased":
        window.location.assign(DEFAULT_AFTER_SIGN_IN_PATH);
        return;
      case "error":
        setError(result.message);
        running.current = false;
        setPending(false);
        return;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pending, error, start, clearError };
}
