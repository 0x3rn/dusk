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
4. **Brute-Force Rate Limiting (`SlidingWindowRateLimiter`)**:
   * Login attempts: Max **5 attempts per 15 minutes**
   * Recovery Kit attempts: Max **3 attempts per hour**
   * Beneficiary package unlock attempts: Max **5 attempts per 30 minutes**

---

## 2. Clean-Environment Deployment Checklist

When deploying Dusk to a brand-new production environment (e.g., Vercel + Neon PostgreSQL):

### Step 1: Set Required Environment Variables
 Configure these in your hosting dashboard (validated automatically on startup by `lib/env.ts`):
* `DATABASE_URL`: Your Neon PostgreSQL pooled connection string (must include `?sslmode=require`).
* `SESSION_SECRET`: Generate a 48-byte random secret in your terminal using `openssl rand -base64 48`.
* `NEXT_PUBLIC_APP_URL`: Your production domain (e.g., `https://dusk.app`).
* `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: For Google Sign-In.
* `RESEND_API_KEY`: Your Resend API key (ensure SPF, DKIM, and DMARC records are verified on your domain so check-in emails never land in spam).
* `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: For SMS fallback warnings.
* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: For $50 lifetime access checkout.

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
* **Action:** The user opens the **Security Center** (`THE-109`) and clicks **"Revoke All Other Sessions"**, or uses their **Offline Recovery Kit** (`THE-99`) to re-enroll.
* **What happens:** Every session row in Neon PostgreSQL gets `revokedAt = NOW()`, kicking the stolen laptop out on its very next request.

**Situation 2 — You need to rotate server environment secrets (`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `SESSION_SECRET`) or revoke all active sessions platform-wide:**
1. Update the secret in your Vercel/hosting environment variables and redeploy.
2. If you ever suspect a platform-wide session cookie issue and want to force every user to log in fresh, run this in Neon SQL Editor:
   ```sql
   UPDATE "Session"
   SET "revokedAt" = NOW()
   WHERE "revokedAt" IS NULL;
   ```