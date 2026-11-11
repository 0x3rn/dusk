"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { secondsLeft } from "@/lib/auth/cooldown";

/** A countdown for "Send a new code". `start()` begins the wait; `remaining` is whole seconds left. */
export function useCooldown(seconds: number): { remaining: number; start: () => void } {
  const endsAt = useRef(0);
  const [remaining, setRemaining] = useState(0);

  const start = useCallback(() => {
    endsAt.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }, [seconds]);

  const active = remaining > 0;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const left = secondsLeft(endsAt.current, Date.now());
      setRemaining(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [active]);

  return { remaining, start };
}
