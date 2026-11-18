// cloudflare-env.d.ts
// The bindings and variables the Dusk Worker is given (see wrangler.jsonc). Secrets are listed in
// docs/CLOUDFLARE.md. Written by hand so it never depends on anyone's local .env files.
interface CloudflareEnv {
  /** Static files built by OpenNext. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The Worker itself, used by the cron timer to call the app without leaving Cloudflare. */
  WORKER_SELF_REFERENCE: { fetch(request: Request): Promise<Response> };
  /** Optional Hyperdrive binding. When present the database connection goes through it. */
  HYPERDRIVE?: { connectionString: string };
  APP_URL: string;
  CRON_SECRET: string;
}
