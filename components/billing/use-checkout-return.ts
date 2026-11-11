"use client";

import { useEffect, useRef, useState } from "react";
import { CHECKOUT_SUPPORT_PLACEHOLDER } from "@/lib/billing/checkout-client";

const POLL_EVERY_MS = 3_000;
const MAX_POLLS = 20; // about a minute

/**
 * Lemon Squeezy sends people back to /dashboard?checkout=success, but the payment reaches us
 * through a separate webhook that can arrive a moment later. This tells the person what is
 * happening and re-checks their account until access shows up.
 */
export function useCheckoutReturn(options: {
  loaded: boolean;
  hasLifetimeAccess: boolean;
  refresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const { loaded, hasLifetimeAccess, refresh, onMessage } = options;
  const returning = useRef<boolean | null>(null);
  // State, not a ref: each poll must re-run the effect below even if nothing else changed.
  const [polls, setPolls] = useState(0);

  // Read the flag once, and remove it so a refresh does not repeat the message.
  useEffect(() => {
    if (returning.current !== null) return;
    const params = new URLSearchParams(window.location.search);
    returning.current = params.get("checkout") === "success";
    if (returning.current) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!loaded || !returning.current) return;
    if (hasLifetimeAccess) {
      returning.current = false;
      onMessage("Payment received. Your lifetime access is active.");
      return;
    }
    if (polls >= MAX_POLLS) {
      returning.current = false;
      onMessage(
        `Your payment is taking longer than usual to confirm. You haven't lost anything. Check Settings in a few minutes, or contact ${CHECKOUT_SUPPORT_PLACEHOLDER}.`
      );
      return;
    }
    if (polls === 0) onMessage("Thank you. We're confirming your payment. This usually takes under a minute.");
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      void refresh();
    }, POLL_EVERY_MS);
    return () => clearTimeout(timer);
  }, [loaded, hasLifetimeAccess, polls, refresh, onMessage]);
}
