// lib/env.ts
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v : undefined));

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Neon PostgreSQL
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Neon PostgreSQL connection string)")
    .refine(
      (url) => url.startsWith("postgres://") || url.startsWith("postgresql://"),
      "DATABASE_URL must be a valid PostgreSQL connection string"
    ),

  // Neon Auth (Managed Better Auth)
  NEON_AUTH_BASE_URL: z.string().url("NEON_AUTH_BASE_URL must be the Auth URL from the Neon Console"),
  NEON_AUTH_COOKIE_SECRET: z
    .string()
    .min(32, "NEON_AUTH_COOKIE_SECRET must be at least 32 characters for cryptographic safety"),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Scheduler: shared secret the durable scheduler presents to /api/internal/scheduler/tick
  CRON_SECRET: z
    .string()
    .min(32, "CRON_SECRET must be at least 32 characters")
    .optional(),

  // Payments
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  // Notification providers
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_PHONE_NUMBER: optionalString,

  // Observability
  SENTRY_DSN: optionalString,
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }
  return parsed.data;
}

let cached: ServerEnv | null = null;

/** Validated server environment, parsed once on first use (not at import, so `next build` works without secrets). */
export function getServerEnv(): ServerEnv {
  if (!cached) cached = validateEnv();
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetServerEnvCache(): void {
  cached = null;
}
