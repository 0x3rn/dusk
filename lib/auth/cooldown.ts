// lib/auth/cooldown.ts
// Pure helper for the "Send a new code" wait. The browser hook lives in components/auth.

export const RESEND_COOLDOWN_SECONDS = 60;

/** Whole seconds left until `endsAt`, never negative. Rounds up so the button never says 0 while locked. */
export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
