# Running Dusk on Cloudflare

Dusk runs as **one Cloudflare Worker** that does two jobs: it serves the whole Next.js app, and it runs the dead-man's-switch timer every 15 minutes (`worker/index.ts`). It is built with `@opennextjs/cloudflare` (OpenNext).

## What you need

| Need | Why |
| --- | --- |
| **Workers Paid plan** (about $5 a month) | The built Worker is about 5.2 MiB compressed. The free plan allows 3 MiB, the paid plan 10 MiB. The free plan also allows only 10 ms of CPU per request, which is too little for server-rendered pages. |
| Cloudflare API token | Only for CI or the command line: *Workers Scripts: Edit* on your account. |
| The app's secrets | Listed below. They are stored in Cloudflare, never in the build. |

## How it is built

- `npm run cf:build` builds the Worker into `.open-next/`. `wrangler.jsonc` points at `worker/index.ts`.
- **Build on Linux** (GitHub Actions, or Cloudflare Workers Builds). On Windows, `scripts/cf.mjs` adds a small shim so local builds work, but use those only for local testing.
- OpenNext copies every value from `.env` and `.env.local` into the Worker as plain text. So **never deploy a build made on a machine that has real secrets in those files.** `npm run cf:deploy` checks for this and refuses (`scripts/bundled-env-guard.mjs`). A clean checkout has no `.env` files, so a CI build passes.
- The two public values that Next bakes in at build time, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SENTRY_DSN`, must be set as **build variables** in CI.

## Git build on Cloudflare (Workers Builds)

If the repository is connected in the Cloudflare dashboard (Workers & Pages > dusk > Settings > Build), use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run cf:build` |
| Deploy command | `npm run cf:deploy` |
| Root directory | `/` (empty) |
| Build variables | `NEXT_PUBLIC_APP_URL` = `https://dusk.corstack.dev`, and `NEXT_PUBLIC_SENTRY_DSN` if you have one |

- Cloudflare runs `npm ci` itself before the build command. The Worker name in the dashboard must be `dusk`, matching `wrangler.jsonc`.
- **Build variables** exist only while building. **Runtime variables and secrets** (Settings > Variables and Secrets, or `wrangler secret put`) are what the running Worker sees. They are two separate lists, and Dusk needs both.
- The builder's Node version is pinned to 22 by `.node-version`. The lockfile must stay readable by npm 10, which Node 22 ships. If a build ever fails at install with "Missing: ... from lock file", regenerate it with `npx -p node@22 -p npm@10 npm install --package-lock-only`.

## Database connection

`lib/db.ts` uses Prisma with the `pg` driver adapter. A Worker may not share a database connection between requests, so each request gets its own client (`lib/db-provider.ts`). By default the connection uses `DATABASE_URL`. To route it through **Hyperdrive** (connection pooling close to the Worker, recommended for speed), create a Hyperdrive config for the Neon database and add this to `wrangler.jsonc`; the code uses it automatically:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive config id>" }]
```

## Secrets (set once with `npx wrangler secret put NAME`)

`DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`, and when used: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SENTRY_DSN`.

`CRON_SECRET` must be the same value the app already uses. `APP_URL` is not a secret and lives in `wrangler.jsonc`.

## Error reporting (Sentry) is not active inside the Worker yet

The server-side Sentry setup is built for Node, so `sentry.server.config.ts` skips it inside a Worker. Browser error reporting is unaffected. Until Worker error reporting is set up and tested with a real DSN, errors are visible in the Worker's logs (Cloudflare dashboard, Observability). The planned fix is `@sentry/cloudflare` wrapped around the Worker entry.

## Test it locally before any deploy

```bash
npm run cf:build
npm run cf:preview          # runs the built Worker in workerd on http://localhost:3100
E2E_PORT=3100 npx playwright test
```

This runs the real Workers runtime against the dev database. Do not point it at production.

## Domain

The site lives at `https://dusk.corstack.dev`. The custom domain is attached to the `dusk` Worker in the Cloudflare dashboard (Workers & Pages > dusk > Domains), not in `wrangler.jsonc`, so a deploy never changes it. Three other places must name the same address:

1. **Build variable** `NEXT_PUBLIC_APP_URL` = `https://dusk.corstack.dev` (links in emails and the invitation page use it).
2. **Neon Auth trusted domain**: add `dusk.corstack.dev` in the Neon console (or sign-in is refused).
3. **Lemon Squeezy webhook**: `https://dusk.corstack.dev/api/webhook/lemonsqueezy`.

The old `dusk-scheduler` Worker (`scheduler/`) is not needed any more: this Worker runs the timer itself. Delete it when the old host is retired.

## Rollback

Roll back to an earlier Worker version with `npx wrangler rollback`, or in the dashboard under Deployments. The database is shared, so nothing needs to be moved.

## Features worth using on Cloudflare

| Feature | What it gives Dusk | Status |
| --- | --- | --- |
| **Cron Triggers** | The dead-man's-switch timer, in the same Worker, with no HTTP hop. | Done |
| **Observability** | Request logs and `tick_ok` / `tick_failed` events in the dashboard. | On |
| **Hyperdrive** | Pooled, nearby database connections, so pages that read the database feel faster. | Optional, see above |
| **Smart Placement** | Runs the Worker near the Neon database (London) instead of near the visitor, which helps database-heavy pages. | Worth trying after measuring |
| **Queues** | Retries for email and SMS delivery with a dead-letter queue, so a provider outage never loses a reminder. | Recommended next |
| **Rate Limiting binding / WAF rules** | Blocks sign-in and code-request abuse at the edge before it reaches the database. | Recommended next |
| **Turnstile** | Bot check on register and sign-in without a CAPTCHA puzzle. | Optional |
| **R2** | Cheap storage for large encrypted files, if file uploads grow. | Only if needed |
