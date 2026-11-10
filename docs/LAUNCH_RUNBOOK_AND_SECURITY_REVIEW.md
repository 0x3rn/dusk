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
  * Account login hashes (`scrypt`), SHA-256 session token hashes, contact emails/phones, and Dead-Man's Switch timer states

### Web & API Hardening Active in Production (`lib/security/http-hardening.ts`)
1. **`Referrer-Policy: no-referrer`**: Ensures that when a beneficiary opens `/unlock/[contactId]#privateKey`, the browser never leaks the URL or `#hash` to any external link or analytics header.
2. **Clickjacking & XSS Defense (`Content-Security-Policy` + `X-Frame-Options: DENY`)**: Blocks any third-party site from embedding Dusk in an `<iframe>` to trick a user into unlocking their vault or approving a release.
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
* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: For $50 lifetime access checkout. The webhook endpoint is `/api/webhook/stripe` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`).
* `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (optional): Error reporting. Reports are scrubbed of request bodies, cookies, emails and token links (`lib/observability/sentry-scrub.ts`).

Neon Auth settings to confirm on the **production** branch: email and password enabled, **Require email verification** turned on (existing accounts are linked to their Dusk data by *verified* email only), and your production domain added as a trusted domain.

### Step 1b: Database changes (run once, in order)
The SQL files in `prisma/sql/` are applied by hand in the Neon SQL Editor (this project does not use `prisma db push`, which would drop data):
1. `001_neon_auth_identity.sql` and `003_rate_limit.sql`: additive and safe to run any time.
2. `002_drop_legacy_auth.sql`: **destructive.** Run it only after every real user has signed in once through Neon Auth (`SELECT count(*) FROM "User" WHERE "authUserId" IS NULL;` must show no real accounts). It deletes the old password hashes.

### Step 1c: Start the scheduler
The dead-man's switch only runs when something calls the tick endpoint. The project ships a Trigger.dev schedule (`trigger/dead-mans-switch.ts`, every 15 minutes):
1. Create a project at trigger.dev and copy its `proj_...` id into `TRIGGER_PROJECT_REF`.
2. In the Trigger.dev project's environment variables set `APP_URL` (your production URL) and `CRON_SECRET` (same value as above).
3. Deploy it: `npx trigger.dev@latest deploy`.
Each run is safe to repeat: state changes are keyed in the database, reminders are one per day, and overlapping runs are skipped by a database lock.

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

**Situation 2 — You need to rotate server environment secrets (`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `NEON_AUTH_COOKIE_SECRET`, `CRON_SECRET`) or revoke all active sessions platform-wide:**
1. Update the secret in your Vercel/hosting environment variables and redeploy. (Changing `CRON_SECRET` also means updating it in Trigger.dev.)
2. Changing `NEON_AUTH_COOKIE_SECRET` makes every browser cookie invalid, so everyone signs in again.
3. To end every Neon Auth session directly, run this in the Neon SQL Editor:
   ```sql
   DELETE FROM neon_auth.session;
   ```