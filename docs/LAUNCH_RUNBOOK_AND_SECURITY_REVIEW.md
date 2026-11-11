# Dusk Production Security Review, Disaster Recovery & Launch Runbook (`THE-111`)

## 1. Cryptographic & Security Architecture Summary

### What Dusk Can and Cannot See
* **What stays on the user's device (Never seen by Dusk servers):**
  * The user's Master Passphrase
  * The 256-bit Vault Master Key (`VMK`)
  * Plaintext titles, usernames, passwords, seed phrases, notes, folder names, and file contents
  * The user's offline Recovery Code (`DUSK-XXXX-...`)
  * A beneficiary's Private Key (`#hash` fragment in their unlock URL)
* **What is stored in Neon PostgreSQL:**
  * Encrypted ciphertext blobs (`AES-256-GCM`) and their 12-byte random IVs
  * Wrapped (encrypted) keys that can only be unlocked by the user's passphrase, the user's Recovery Kit, or the assigned beneficiary's private key
  * Per-vault salt and an algorithm identifier for the passphrase and recovery-code key derivation (Argon2id `ARGON2ID-19456-2-1` for new vaults; `PBKDF2-SHA256-600000` / `PBKDF2-SHA256-310000` for vaults created earlier; existing vaults are upgraded to Argon2id automatically the next time the owner unlocks with the passphrase, recorded as a `VAULT_KDF_UPGRADED` audit event; see `docs/THREAT_MODEL.md` section 4.1)
  * Account sign-in hashes are held by **Neon Auth** in its own schema (Dusk code never handles them); SHA-256 session token hashes, contact emails/phones, and Dead-Man's Switch timer states

### Web & API Hardening Active in Production (`lib/security/http-hardening.ts`)
1. **`Referrer-Policy: no-referrer`**: Ensures that when a beneficiary opens `/unlock/[contactId]#privateKey`, the browser never leaks the URL or `#hash` to any external link or analytics header.
2. **Script injection and clickjacking defense (per-request nonce `Content-Security-Policy` + `X-Frame-Options: DENY`)**: the policy is built for every page request in `proxy.ts` (`lib/security/csp.ts`) with a fresh random nonce: `script-src 'self' 'nonce-<random>' 'strict-dynamic' 'wasm-unsafe-eval'`, no `'unsafe-inline'` for scripts, and `'unsafe-eval'` in development only. It also sets `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and, in production, `upgrade-insecure-requests`. `worker-src 'self'` lets the key-derivation Web Worker start (without it `'strict-dynamic'` makes browsers block the worker), and the worker script itself is served with a stricter policy that forbids any network request (`WORKER_SCRIPT_CSP`, set for `/_next/static/*` in `next.config.ts`). `connect-src` allows only the site itself and the Sentry ingest hosts. Styles still allow `'unsafe-inline'` (React and Framer Motion write inline style attributes); scripts are the part that matters. Because the nonce is per request, every page is rendered on demand (no static pre-rendering and no CDN page cache). The other headers (HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `nosniff`, DNS prefetch) are static and set in `next.config.ts`. Browser tests `tests/e2e/csp.spec.ts` and `tests/e2e/kdf-worker.spec.ts` fail if any page produces a CSP violation or a script without the nonce, or if creating or unlocking a vault produces a violation or console error (run against a production build: `npm run build`, then `next start`).
3. **CSRF Origin Check (`assertCsrfSafeMutationRequest`)**: Blocks malicious websites from submitting `POST`/`DELETE` requests on behalf of a logged-in Dusk user.
4. **Brute-Force Rate Limiting (`lib/security/db-rate-limiter.ts`)**: counters live in PostgreSQL (`RateLimitBucket`) so the limit holds across every serverless instance.
   * Beneficiary package unlock attempts: Max **5 attempts per 30 minutes** per caller and beneficiary
   * Check-in and verifier links: Max **10 attempts per 15 minutes** per caller
   * Sign-in rate limiting and password checks are handled by **Neon Auth** (Managed Better Auth).

---

## 2. Clean-Environment Deployment Checklist

When deploying Dusk to a brand-new production environment (e.g., Vercel + Neon PostgreSQL):

### Step 1: Set Required Environment Variables
 Configure these in your hosting dashboard (validated by `lib/env.ts`):
* `DATABASE_URL`: Your Neon PostgreSQL pooled connection string (must include `?sslmode=require`).
* `NEON_AUTH_BASE_URL`: The Auth URL from Neon Console, Project, Branch, **Auth**, Configuration.
* `NEON_AUTH_COOKIE_SECRET`: At least 32 characters. Generate with `openssl rand -base64 32`.
* `NEXT_PUBLIC_APP_URL`: Your production domain (e.g., `https://dusk.app`).
* `CRON_SECRET`: At least 32 characters. The shared secret the scheduler sends to `/api/internal/scheduler/tick`. Generate with `openssl rand -hex 32`.
* `RESEND_API_KEY`, `RESEND_FROM_EMAIL`: Your Resend key and verified sender (ensure SPF, DKIM, and DMARC are verified so check-in emails never land in spam).
* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: For SMS fallback warnings.
* `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`: For the one-time lifetime access purchase (Lemon Squeezy is the payment provider and merchant of record). With any of them missing, checkout and the webhook answer 503 and nothing else breaks. Set-up is in "Step 1c: Lemon Squeezy".
* `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (optional): Error reporting. Reports are scrubbed of request bodies, cookies, emails and token links (`lib/observability/sentry-scrub.ts`).

Neon Auth settings to confirm on the **production** branch: email and password enabled, **Require email verification** turned on (existing accounts are linked to their Dusk data by *verified* email only), and your production domain added as a trusted domain. Also turn on **end all sessions on password reset** (`revoke_sessions_on_password_reset`), so a password reset signs out every device, and keep your production domain in the trusted domains list.

### Step 1b: Database changes (run once, in order)
The SQL files in `prisma/sql/` are applied by hand in the Neon SQL Editor (this project does not use `prisma db push`, which would drop data):
1. `001_neon_auth_identity.sql` and `003_rate_limit.sql`: additive and safe to run any time.
2. `004_lemonsqueezy.sql`: additive and safe to run any time and more than once (adds the `PaymentEvent` ledger table and `User.lemonSqueezyCustomerId`). Run it **before** deploying the Lemon Squeezy release. It leaves the old Stripe table and column alone, so the old code keeps working until the new release is live.
3. `005_contact_declined.sql`: additive and safe to run any time and more than once (adds the `DECLINED` contact status). Run it **before** deploying the invitation flow: the invitation page needs it to record a declined invitation.
4. `007_retention_indexes.sql`: additive and safe to run any time and more than once (three indexes on `createdAt` so the retention purge finds old rows quickly). Run it **before** deploying the retention purge; without the indexes the purge still works but reads whole tables every 15 minutes.
5. `002_drop_legacy_auth.sql`: **destructive.** Run it only after every real user has signed in once through Neon Auth (`SELECT count(*) FROM "User" WHERE "authUserId" IS NULL;` must show no real accounts). It deletes the old password hashes.
6. `006_drop_stripe.sql`: **destructive and not yet run anywhere.** It drops the old `StripeEvent` table and `User.stripeCustomerId`. Run it only after the Lemon Squeezy release is live and one real purchase and refund have been checked end to end. Export the old Stripe records first if you want to keep them, and take a Neon snapshot before running it.

### Step 1c: Lemon Squeezy (lifetime purchase)
1. In Lemon Squeezy create a product with one **single-payment** variant priced at **$50 USD** (the price shown on the website; Lemon Squeezy, not Dusk, decides what is charged). Copy the numeric **store id** and **variant id** into `LEMONSQUEEZY_STORE_ID` and `LEMONSQUEEZY_VARIANT_ID`.
2. Settings, API: create an API key and set `LEMONSQUEEZY_API_KEY`. Use a test-mode key while testing and a live-mode key in production.
3. Settings, Webhooks: add a webhook with URL `https://<your domain>/api/webhook/lemonsqueezy`, tick the events **order_created** and **order_refunded**, and type a signing secret (6 to 40 characters, e.g. from `openssl rand -hex 16`). Put the same value in `LEMONSQUEEZY_WEBHOOK_SECRET`. Test-mode and live-mode webhooks are separate: create both and use the matching secret per environment.
4. What happens: a signed-in user presses Buy and `POST /api/checkout` creates a checkout with their user id attached on the server. After payment Lemon Squeezy calls the webhook. The webhook checks the `X-Signature` header, then grants access only for a **paid** `order_created` whose store and variant match your settings. A **full** `order_refunded` removes access (unless the user has another paid order) and writes an audit event; a partial refund is recorded and access stays.
5. Replays are safe: every handled event is recorded once in `PaymentEvent` (keyed by event name and order id), so a repeated delivery changes nothing. Failed deliveries are retried by Lemon Squeezy; unfixable ones (wrong store/variant, unknown user) are acknowledged and logged as `Rejected order event` in the server log. Watch for that line.
6. If checkout is not configured, `/api/checkout` and the webhook answer 503 and log which variable is missing (never its value).

### Step 1d: Start the scheduler
The dead-man's switch only runs when something calls the tick endpoint. The project ships a small Cloudflare Worker (`scheduler/`) with a cron trigger every 15 minutes that calls it. It is free and needs no change to the app:
1. `cd scheduler` and set `APP_URL` in `wrangler.jsonc` to your production URL (already `https://dusk.somto.xyz`).
2. Set the secret: `npx wrangler secret put CRON_SECRET` (same value as `CRON_SECRET` in Vercel).
3. Deploy it: `npx wrangler deploy`.
4. Check it ran: `npx wrangler tail dusk-scheduler` at the next quarter hour shows `tick_ok`; a failed run shows `tick_failed`.
Each run is safe to repeat: state changes are keyed in the database, reminders are one per day, and overlapping runs are skipped by a database lock.

### Step 1e: How the retention purge runs (the Privacy page's 12-month promises)
The purge is not a separate job. It runs **inside the same scheduler tick**, right after the sweep (`app/api/internal/scheduler/tick/route.ts` calls `runRetentionPurge` from `lib/engine/retention.ts`), so there is nothing extra to deploy or schedule. What it deletes, and nothing else:
* `AuditEvent` and `NotificationDelivery` rows older than 12 months;
* `ReleaseEvent` rows of an estate **released** more than 12 months ago (only rows older than 12 months, and never one whose link is still unexpired);
* `RateLimitBucket` windows older than 24 hours (counters, not personal data).

Safety rules built in:
* A user whose estate was released **less than 12 months ago** keeps all their audit and message records until 12 months after the release (the Privacy page's "Released plans" row). `ReleaseEvent` rows of any estate that has **not** been released (a live plan, a hold, a verification in progress) are never deleted, whatever their age.
* The sweep itself ignores estates released more than 12 months ago (`lib/engine/sweep.ts`). Without that, once their release records were purged the sweep would think nobody had been told and email every beneficiary a new link.
* Batches of 500 rows per statement, at most 5,000 rows per table per run, so a large backlog is cleared over several 15-minute runs. A transaction-level advisory lock (key `727275`, different from the sweep's `727274`) means two overlapping runs cannot race: the second reports `skipped`.
* A purge failure never stops the sweep. The tick response carries counts only: `retention: { skipped | failed | counts: { auditEvents, notificationDeliveries, releaseEvents, rateLimitBuckets }, capped: [...] }`. A `capped` entry means that table reached the per-run limit, so more is waiting. Server logs show `[retention] purge finished` (counts) or `[retention] purge failed` (error class only, never row data).
* To see what a run would delete without deleting, call `runRetentionPurge(prisma, { dryRun: true })` from a script (it counts and changes nothing).
* Check it is working: after the first real run, `SELECT count(*) FROM "AuditEvent" WHERE "createdAt" < now() - interval '12 months';` should fall to the rows that belong to users released in the last 12 months (normally 0).


### Step 2: Run Pre-Launch Verification Commands
```bash
npx prisma generate
npx prisma migrate deploy
npm test
npm run typecheck
npm run build
```

---

## 3. Backup & Disaster Recovery (Explained Plainly)

### The Core Problem
If your database or file storage ever gets corrupted, accidentally deleted, or hit by an outage, you need to restore every user's vault and check-in timers **without** breaking zero-knowledge security (meaning backups must never create a "secret master key" that lets someone read user vaults).

### 3.1 How Database Backups Work (Neon PostgreSQL)
* **What to enable in Neon:** Turn on **Neon Point-in-Time Recovery (PITR)** (retaining 14 to 30 days of history) and **Automated Daily Branch Snapshots**.
* **Why this is 100% Zero-Knowledge Safe:**
  Even if someone steals a database backup file, every vault item inside that backup is already encrypted with `AES-256-GCM`, and every session token is stored only as a one-way `SHA-256` hash. Restoring a Neon backup brings back the user's encrypted vault and timer state, while keeping their secrets completely unreadable to you or anyone else.
* **How to restore if database corruption occurs:**
  1. Open the Neon Console $\rightarrow$ **Restore** $\rightarrow$ select the timestamp just before the incident.
  2. Immediately after restoring, pause the background Dead-Man's Switch cron job for 24 hours so no user is penalized for time lost during the outage.

### 3.2 How Encrypted File Attachment Backups Work (Object Storage)
* **What is stored in Object Storage:** Only raw encrypted binary blobs named by random UUID keys (`EncryptedFile.storageBlobKey`). Even the original filename (e.g., `living-trust.pdf`) is encrypted inside the database.
* **What to enable:** Turn on **Bucket Versioning** and **Cross-Region Replication** on your S3/R2/Cloud Storage bucket.
* **How Dusk detects corrupted files automatically:**
  Every file row in Neon PostgreSQL stores `ciphertextSha256Hex` (the exact SHA-256 fingerprint of the encrypted file). When a user or beneficiary downloads a file, `decryptVaultFileAttachment()` checks that SHA-256 fingerprint before decrypting. If even 1 byte of the file was corrupted in storage, Dusk catches it immediately instead of silently outputting garbage.

---

## 4. Incident Response & Emergency Operational Runbooks

Here is exactly what to do in the three most critical real-world emergencies:

---

### Scenario A: A User (or Family Member) Panics Because a False Alarm Escalation Started
**Situation:** A user was traveling without internet or in the hospital, missed their 90-day check-in, and their vault is now in `GRACE_PERIOD`, `ESCALATION_PENDING`, or `VERIFICATION_REQUIRED`—and they want to stop it from releasing to beneficiaries.

**There are 3 ways to stop it immediately (from easiest to last-resort):**

1. **Way 1 — The User Logs In (Self-Service):**
   * The user logs into `/dashboard` and clicks **"I Am Alive (Check In)"**.
   * **What happens:** The state machine immediately resets to `HEALTHY`, wipes `remindersSentCount = 0`, and starts a fresh 90-day timer.
2. **Way 2 — A Trusted Verifier Steps In (If the User Cannot Log In):**
   * Any contact marked as a **Trusted Verifier** submits an **"Alive Signal"** (`signalUserAliveByTrustedContact`) or places a **"Release Hold"** (`placeReleaseHold`).
   * **What happens:** The switch immediately freezes in `RELEASE_HOLD` or resets to `HEALTHY`. The Trusted Verifier does **not** get access to any vault secrets—they only have the power to protect the user from a false release.
3. **Way 3 — Operator Emergency Hold (If the User Emails Support and Cannot Access Their Device):**
   * Because you (the operator) cannot decrypt their vault, you **can** safely freeze their timer in Neon PostgreSQL so nothing is released while they recover their device.
   * **Exact SQL command to freeze a user's switch in Neon Console:**
     ```sql
     UPDATE "CheckInSchedule"
     SET "state" = 'RELEASE_HOLD', "updatedAt" = NOW(), "version" = "version" + 1
     WHERE "userId" = '<USER_ID>';
     ```
   * **Result:** While `state = 'RELEASE_HOLD'`, the Dusk verification engine (`authorizeEstateRelease`) is mathematically blocked from releasing any beneficiary packages (`ACTIVE_RELEASE_HOLD`).

---

### Scenario B: Resend (Email) or Twilio (SMS) Goes Down
**Situation:** Resend or Twilio has a major outage on the exact day a user's check-in reminder is supposed to be sent.

* **What Dusk does automatically (You don't have to panic):**
  1. If **Email fails**, `NotificationAndAuditService` retries Email twice, and then **automatically switches to SMS** (`SMS_FALLBACK`) via Twilio so the user still gets the text message.
  2. If **both Email and SMS are down**, Dusk's **Fail-Closed Outage Rule** kicks in:
     * Dusk **refuses** to increase `remindersSentCount`.
     * Dusk **refuses** to advance the user's schedule into `VERIFICATION_REQUIRED` or `RELEASED`.
     * In short: **An email/SMS outage can never accidentally trigger a user's Dead-Man's Switch.**
* **What you (the operator) should do when the provider comes back online:**
  1. Check the `NotificationDelivery` table in Neon for rows where `status = 'FAILED'` and `lastError` shows the outage.
  2. Re-run the notification job. Because every notification has a unique `idempotencyKey`, users who *did* already receive the message will be skipped automatically (no duplicate spam), and only the failed ones will be re-sent.

---

### Scenario C: Rotating Compromised Secrets or Sessions
**Situation 1 — A user suspects their laptop or phone was stolen:**
* **Action:** The user opens the **Security Center** (`GET/POST /api/security`) and revokes other sessions, or uses their **Offline Recovery Kit** (`THE-99`) to re-enroll.
* **What happens:** The sessions are revoked in Neon Auth. The stolen laptop loses access within about a second (the session cache is 1 second, set in `lib/auth/server.ts`).

**Situation 2 — You need to rotate server environment secrets (`RESEND_API_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`) or revoke all active sessions platform-wide:**
1. Update the secret in your Vercel/hosting environment variables and redeploy. (Changing `CRON_SECRET` also means running `npx wrangler secret put CRON_SECRET` in `scheduler/`.)
2. Changing `NEON_AUTH_COOKIE_SECRET` makes every browser cookie invalid, so everyone signs in again.
3. To end every Neon Auth session directly, run this in the Neon SQL Editor:
   ```sql
   DELETE FROM neon_auth.session;
   ```

---

### Scenario D: Account deletion edge cases
Account deletion is self-serve (Settings, Delete account). The code is `lib/account/delete-account.ts`; the route is `POST /api/account/delete`.

**What it does.** After a one-time code emailed by Neon Auth to the signed-in person's own address (the server checks the code against the email in the session, never against anything the browser sends) and a typed email, one database transaction deletes the Dusk user (everything cascades: vault, folders, items, files, people, assignments, schedule, workflow and release events, recovery artifacts, message and activity records) **and** the Neon Auth identity (`neon_auth."user"` plus its sessions, accounts and pending codes). All or nothing. The `PaymentEvent` ledger is kept on purpose (it has no foreign key to `User`).

**Why SQL for the Neon Auth identity.** The managed Neon Auth service does not offer self-serve user deletion on this project (`POST /delete-user` answers 404, and the admin removal call needs an admin session), and we deliberately store no Neon API key. The app's database role owns the `neon_auth` schema and Neon Auth reads sessions and accounts straight from those tables, so deleting the row ends every sign-in at once. Verified on the dev branch: the old cookie stopped being a session, the old password was refused, and the same email registered again as a new account. **Before launch, check on the production branch** (read-only first): `SELECT current_user, has_table_privilege(current_user, 'neon_auth."user"', 'DELETE');` must show `true`. If the production role cannot delete from `neon_auth`, deletion fails safe (the transaction rolls back, the person is told nothing was deleted) and you must fix the role before launch.

**Edge cases and what to do.**
* *Person says "I deleted my account but I can still sign in."* The transaction is all or nothing, so either the deletion did not happen (they saw an error) or they registered again with the same email (a new, empty account). Check `SELECT count(*) FROM "User" WHERE email = '<email>';` and compare with `SELECT "createdAt" FROM neon_auth."user" WHERE email = '<email>';`.
* *Deletion fails with "We couldn't finish deleting your account".* Nothing was deleted. Look in the server log for `[account-delete] transaction failed` (error class only). The usual cause is a permission or schema change in `neon_auth` (Neon changed a table). Fix the cause; the person can simply try again with a new code.
* *Person cannot sign in and asks by email.* Confirm the request comes from the account email, then delete the identity and the data yourself. In the Neon SQL Editor, in one transaction (replace the email; check the two ids first with the SELECT):
  ```sql
  BEGIN;
  SELECT id, "authUserId" FROM "User" WHERE email = '<email>';
  SELECT id FROM neon_auth."user" WHERE email = '<email>';
  DELETE FROM "User" WHERE email = '<email>';                 -- cascades to everything of theirs
  DELETE FROM neon_auth.verification WHERE identifier LIKE '%-otp-<email>';
  DELETE FROM neon_auth."user" WHERE email = '<email>';       -- sessions and accounts cascade
  COMMIT;
  ```
  Alternatively use the Neon API/MCP `delete_auth_user` for the identity step. Never delete more than the one email.
* *A release was under way or finished when they deleted.* The Settings screen warns them and requires a tick box (the server enforces it). Deleting stops the process: no one is told, grant links stop working, items not yet opened are destroyed. Release events for that estate are gone with the account. If a beneficiary complains their link stopped working, this is why; there is nothing to restore (Dusk cannot read the vault, and we do not restore deleted accounts from backups).
* *Double click / two tabs.* Safe: the second request finds nothing left to delete and still answers success.
* *Backups.* Deleted data remains in Neon's recovery history until it ages out (the Privacy page promises within 30 days). Do not restore a deleted account from a backup.
* *Files.* Encrypted file rows are deleted with the account. Object-storage blobs (`EncryptedFile.storageBlobKey`) are not removed by this code because the app currently stores no blobs outside the database; if you add object storage, add its cleanup to `deleteAccountRows` in the same change.
* *Leftover payment record.* Intended. `PaymentEvent` rows keep the order reference and outcome; they no longer match any account.
