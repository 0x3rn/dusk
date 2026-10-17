# Dusk Threat Model & Zero-Knowledge Trust Boundaries (THE-96)

## 1. Executive Summary & Core Security Invariants

Dusk is a zero-knowledge digital estate vault and staged dead-man's switch. Its architecture is governed by two non-negotiable invariants:

1. **Cryptographic Zero-Knowledge Invariant:**
   Possession of the Dusk PostgreSQL database (Neon), object storage blobs, application server memory during normal vault CRUD, logs, and operational backups is **cryptographically insufficient** to decrypt any user's vault items, file attachments, or beneficiary release packages.
2. **Staged Verification Invariant ("A Missed Email Is Not Proof of Death"):**
   No single missed check-in, single email/SMS delivery event, or unverified timer expiration can transition an estate into the `RELEASED` state. Uncertain or degraded system state must always **fail closed** (holding or pausing escalation rather than releasing).

---

## 2. Protected Assets

| Asset | Classification | Storage Location | Who Can Read Plaintext? |
| :--- | :--- | :--- | :--- |
| **Vault Master Key (VMK)** | Critical Secret (Root) | Client memory only; wrapped in Recovery Kit & wrapped per-item/package | User client device only |
| **Item Encryption Keys (IEK) / File Keys (FEK)** | Critical Secret | Wrapped under VMK (for owner) and wrapped under Beneficiary Public Key (for release) | User client; Assigned Beneficiary client (post-release only) |
| **Vault Item Plaintext** (credentials, seed phrases, notes, wishes) | Critical Secret | Never stored in plaintext; encrypted with `AES-256-GCM` before upload | User client; Assigned Beneficiary client (post-release only) |
| **Vault File Attachments** | Critical Secret | Object storage as `AES-256-GCM` encrypted blobs + integrity tag | User client; Assigned Beneficiary client (post-release only) |
| **Recovery Kit Secret / Passphrase** | Critical Secret | User offline storage (PDF/printable kit); never sent to server | User (or executor holding physical kit) |
| **Beneficiary Private Key / Decryption Secret** | Critical Secret | Client-generated; delivered to beneficiary out-of-band / URL fragment (`#`) or derived keypair | Intended Beneficiary only |
| **Beneficiary Assignments & Release Scope** | Sensitive Operational Metadata | Neon PostgreSQL (`ReleaseAssignment`) | User, Dusk Server (for routing only) |
| **Check-In Schedule & Workflow State** | Operational State | Neon PostgreSQL (`CheckInSchedule`, `WorkflowEvent`) | User, Dusk Server |
| **Contact Channels (Email, Phone)** | PII / Operational Metadata | Neon PostgreSQL (`Beneficiary`, `TrustedContact`, `User`) | User, Dusk Server, Notification Providers (Resend/Twilio) |
| **Audit & Security Timeline** | Tamper-Evident Operational Record | Neon PostgreSQL (`AuditEvent` - append-only) | User, Dusk Server |

---

## 3. Adversary Model

### A1. Database / Object-Storage Compromise
* **Capabilities:** Full read access to Neon PostgreSQL tables and all object-storage buckets.
* **Mitigation:**
  * All vault items and files are encrypted client-side using `AES-256-GCM` with unique 96-bit nonces and authenticated additional data (`AAD` binding `vaultId`, `itemId`, `keyVersion`, and `itemType`).
  * The server stores only ciphertext, IV/nonce, auth tag, key version, and wrapped keys.
  * Passwords for authentication are hashed with Argon2id (or scrypt with high cost) using a distinct server-side auth salt—never reusing the client-side key derivation salt or password hash as an encryption key.

### A2. Malicious or Compromised Operator / Server
* **Capabilities:** Inspects incoming HTTP requests, server logs, error telemetry, and database records.
* **Mitigation:**
  * Plaintext payloads and raw keys never leave the browser in API request bodies, query strings, or headers.
  * URL fragments (`#...`) used for client-side key material are never transmitted over HTTP per RFC 3986.
  * Automated server-side boundary guards (`assertZeroKnowledgePayload`) reject any API request containing forbidden plaintext or raw key fields before persistence or logging.

### A3. Stolen User Session / Compromised Device
* **Capabilities:** Attacker obtains an active session cookie or access to an unlocked browser tab.
* **Mitigation:**
  * Sessions are tracked server-side in Neon PostgreSQL (`Session`) with device metadata, IP/UA risk signals, expiration, and instant revocation (`THE-109`).
  * Vault Master Key is not persisted in cookies or server session state; sensitive actions (changing beneficiaries, rotating keys, disabling check-ins, exporting recovery kit) require re-verification / active vault unlock and emit immutable `AuditEvent` records.
  * False-trigger cancellation is available from any authenticated session.

### A4. Compromised Email or SMS Channel
* **Capabilities:** Attacker reads a user's or beneficiary's email inbox or intercepts SMS messages.
* **Mitigation:**
  * Email and SMS are **notification and challenge channels**, never the sole cryptographic root of trust.
  * Check-in links only allow **extending/resetting** the alive timer (a safe, non-destructive action), never accelerating release.
  * Beneficiary access requires: (1) the workflow state machine having completed all grace, escalation, and verification stages in Neon PostgreSQL, (2) beneficiary authentication & contact verification, and (3) client-side decryption using key material wrapped specifically to that beneficiary's X25519/ECDH public key.

### A5. Malicious or Curious Beneficiary / Horizontal Privilege Escalation
* **Capabilities:** A legitimate beneficiary attempts to access vault items before release, or attempts to decrypt items assigned to *another* beneficiary.
* **Mitigation:**
  * **Pre-release:** Server authorization (`THE-104`, `THE-105`) blocks retrieval of encrypted release packages unless the estate workflow state is `RELEASED` and the specific package grant is active, non-expired, and unrevoked.
  * **Cross-beneficiary isolation (`THE-101`):** Each beneficiary has a distinct public/private keypair. Only the Item Encryption Keys (`IEKs`) explicitly assigned to Beneficiary $B_i$ are wrapped under $B_i$'s public key. Even if $B_1$ obtains $B_2$'s encrypted package, $B_1$ lacks $B_2$'s private key and cannot unwrap $B_2$'s `IEKs`.

### A6. Replayed Release Links or Duplicate/Delayed Background Jobs
* **Capabilities:** Scheduler fires twice, network retries duplicate a transition request, or an old verification link is clicked again.
* **Mitigation:**
  * Check-in and release state machines enforce strict, deterministic state transitions guarded by database transactions and optimistic concurrency (`version` / state-precondition checks) (`THE-102`).
  * Single-use action tokens store a cryptographic SHA-256 token hash, `usedAt` timestamp, and `expiresAt` timestamp in PostgreSQL. Replaying a consumed or expired token fails closed.

### A7. Partial Infrastructure or Notification Provider Outage
* **Capabilities:** Resend (email) or Twilio (SMS) is down or rate-limiting when a user's check-in reminder is due.
* **Mitigation:**
  * **Fail-Closed Rule:** Escalation stages require **confirmed notification delivery** (or explicit multi-channel exhaustion across the configured grace window) before advancing the escalation clock (`THE-103`, `THE-108`). A provider outage cannot silently burn through a user's grace period and trigger release.

---

## 4. Client / Server Cryptographic Boundary

### Client-Side Only (Browser / Web Crypto API)
1. Generation of the 256-bit **Vault Master Key (VMK)**.
2. Generation of per-item **Item Encryption Keys (IEK)** and per-file **File Encryption Keys (FEK)**.
3. Encryption and decryption of item payloads and file blobs using `AES-256-GCM` with fresh 12-byte random IVs and authenticated context (`AAD`).
4. Generation of the **Recovery Kit** key material and Argon2id key-wrapping where passphrase-backed recovery is used.
5. Generation of beneficiary keypairs and public-key wrapping (`X25519` / `ECDH P-256` + `HKDF-SHA256` + `AES-256-GCM` key wrapping) of assigned `IEKs` into beneficiary-specific release envelopes.

### Server-Side Only (Next.js API + Neon PostgreSQL)
1. User authentication (Neon Postgres email/password via Argon2id/scrypt + Firebase Google ID token verification) and server-side session lifecycle management.
2. Storage of **opaque encrypted envelopes** (`ciphertext`, `iv`, `authTag`, `aadVersion`, `keyVersion`, `wrappedKey`).
3. Enforcement of resource ownership (`userId` on every vault, item, contact, schedule, and event).
4. Execution of the **Check-In & Release Verification State Machine**, timers, grace periods, trusted-contact alive attestations, and release holds.
5. Dispatch and tracking of email/SMS notifications and append-only audit logging (strictly redacted of any secret material).

---

## 5. Metadata Visibility & Minimization

| Metadata Field | Visible to Server? | Minimization Strategy |
| :--- | :--- | :--- |
| Item Title, Username, Password, Seed Phrase, Notes | **NO** | Packed inside the client-encrypted JSON payload (`ciphertext`). Server only sees an opaque encrypted blob. |
| File Filename & File Contents | **NO** | Original filename and MIME type are encrypted inside the item metadata envelope; object storage stores blobs under random UUID keys. |
| Item Category / Type (e.g., `credential`, `crypto`, `wish`) | Optional / Minimized | Stored as an enum only if needed for UI filtering, or encrypted inside the envelope metadata. |
| Ciphertext Byte Size & Timestamps | **YES** | Inherent to storage; mitigated by standard JSON structure. |
| Beneficiary Contact Info & Role (`RECIPIENT` vs `VERIFIER`) | **YES** | Required for server-side challenge/notification routing. |
| Which Encrypted `itemId` is assigned to which `beneficiaryId` | **YES** | Required so the server can assemble the scoped encrypted release package for each beneficiary without sending the entire vault. |

---

## 6. Fail-Closed Rules for Uncertain Release State

The release engine must **abort transition to `RELEASED` and hold** if any of the following conditions occur:
1. The user has an active check-in or false-trigger cancellation recorded at any point prior to final release commit.
2. The schedule is in `PAUSED` / `SNOOZED` or `RELEASE_HOLD` state.
3. Required reminder/escalation notifications failed to deliver across all configured channels and the minimum grace duration since last successful warning has not elapsed.
4. Any trusted contact has submitted an **"Alive / False Alarm" attestation** during the escalation or verification window.
5. The estate's configured verification policy (e.g., trusted-contact verifier approval or multi-party threshold) has not been satisfied.
6. Database state version or cryptographic key-version consistency checks fail.

---

## 7. Explicit Assumptions & Non-Goals

* **Assumptions:**
  * The user's browser environment is not actively compromised by malware/keyloggers at the moment they unlock their vault or enter secrets.
  * Standard Web Crypto API primitives (`AES-256-GCM`, `SHA-256`, `HKDF`, `ECDH`/`X25519`, `crypto.getRandomValues`) provided by modern browsers and Node.js 20+ are cryptographically sound.
* **Explicit Non-Goals:**
  * Dusk **cannot** recover a user's vault if the user loses **both** their primary credentials/unlocked devices **and** their offline Recovery Kit. There is no server-side master key backdoor.
  * Dusk is a technical encrypted delivery mechanism, **not** a legal will, trust, or substitute for statutory estate administration (`THE-111`).