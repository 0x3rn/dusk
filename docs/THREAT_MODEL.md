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
  * The vault passphrase and the recovery code are stretched in the browser (see section 4.1) and the results never leave the device. The server only stores the random salt and the algorithm identifier next to the wrapped key.
  * Account sign-in passwords are handled by **Neon Auth**, not by Dusk code: Dusk never sees or stores an account password hash, and the account password is never used as, or to derive, an encryption key. The hashing algorithm for account passwords is chosen by that service.

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
4. Generation of the **Recovery Kit** code and the key-wrapping of the VMK under it (Argon2id for kits created now, PBKDF2-SHA256 for older kits; see section 4.1).
5. Generation of beneficiary keypairs and public-key wrapping (`X25519` / `ECDH P-256` + `HKDF-SHA256` + `AES-256-GCM` key wrapping) of assigned `IEKs` into beneficiary-specific release envelopes.

### 4.1 Passphrase and Recovery Key Derivation (what the code really does)

Both derivations run in the browser. The algorithm is named by a versioned identifier stored beside the wrapped key (`Vault.kdfAlgorithm`, `RecoveryArtifact.kdfAlgorithm`). The unlock and recovery paths read that identifier and nothing else to decide how to derive the key (`lib/crypto/kdf.ts`).

| Secret | Entropy source | Existing vaults and kits (created before Argon2id) | New vaults and kits |
| :--- | :--- | :--- | :--- |
| **Vault master passphrase** (typed by a person) | Human-chosen: low entropy, so a slow memory-hard derivation is required | `PBKDF2-SHA256-600000` (PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt). Meets the OWASP minimum; still unlocks unchanged, and is **upgraded to Argon2id automatically the next time the owner unlocks with the passphrase** (see "Automatic upgrade on unlock" below). | `ARGON2ID-19456-2-1` (Argon2id, 19,456 KiB memory, 2 passes, 1 lane, 16-byte random salt): the OWASP-recommended Argon2id setting. Passphrase minimum is 12 characters (new passphrases only). |
| **Recovery code** (`DUSK-...`, 32 symbols from a 32-letter alphabet) | 160 random bits from `crypto.getRandomValues`: not guessable, so the code alone would not need a slow derivation | `PBKDF2-SHA256-310000`, with `+PASSPHRASE` appended when a kit passphrase was added | `ARGON2ID-19456-2-1`, with `+PASSPHRASE` appended when a kit passphrase was added |
| **Optional kit passphrase** (mixed into the recovery derivation; no screen asks for one today) | Human-chosen | covered by the PBKDF2 row above | covered by the Argon2id row above: this is why the recovery path also uses the memory-hard function |

Findings from the review that introduced this section:

* **Labels.** Before this change, `Vault.kdfAlgorithm` was written truthfully (`PBKDF2-SHA256-600000`) but the unlock code ignored it and the page parsed the iteration count out of the label text (`split("-")[2]`). The `RecoveryArtifact.kdfAlgorithm` database default read `ARGON2ID-19456-2-1` although every recovery kit was in fact derived with PBKDF2-SHA256 (310,000 iterations); rows were always written with an explicit, truthful value by the code, so no stored row was mislabelled, but the default was a false claim. Both problems are fixed: the identifier is now the single source of the parameters, and the default is true for every row created from now on. Older rows keep their PBKDF2 identifiers.
* **Recovery code strength.** Code comments described the recovery code as 256 bits; it is 160 bits (32 symbols at 5 bits each). That is far beyond guessing, so it does not weaken anything, and the comment is corrected.
* **Server-supplied parameters.** The iteration count used to come from the server unchecked, so a malicious or compromised server could have made the browser run for hours. Identifiers are now parsed strictly: only `ARGON2ID-<m>-<t>-<p>` with 19,456 to 65,536 KiB, 2 to 6 passes and 1 to 4 lanes, and `PBKDF2-SHA256-<n>` with 600,000 (recovery kits: 310,000) to 1,000,000 iterations are accepted. Anything else is refused before any work starts. The server applies the same check when it stores a vault or recovery kit.
* **Downgrade.** Changing the identifier cannot weaken a vault: every parameter and the algorithm change the derived key, so the wrapped key fails its AES-GCM authentication check and nothing opens. Values below the floor are refused outright.
* **Library.** Argon2id runs through `hash-wasm` 4.12.0 (MIT, no dependencies, no native modules, WebAssembly, pinned to an exact version). It is loaded only when a key is derived. The CSP allows WebAssembly compilation (`'wasm-unsafe-eval'`) for this. Correctness is tested against the Argon2 reference-implementation vector, against the RFC 9106 parameters cross-checked with OpenSSL's independent Argon2id, and with fixed vaults and recovery kits produced by the earlier PBKDF2 code.
* **Where it runs.** Every derivation (vault create/unlock, recovery kit create/recover, re-wrap) goes through one async function, `deriveKeyBytes()` in `lib/crypto/kdf-client.ts`, which runs it in a dedicated Web Worker (`lib/crypto/kdf.worker.ts`; the pure handler is `kdf-worker-core.ts`) so the page does not freeze for the 0.1 to 1 s the work takes. The worker is created on first use, shared by concurrent requests (matched by request id), and terminated after 15 s idle so its WebAssembly memory is released. If `Worker` or `WebAssembly` is unavailable, the worker cannot start within 15 s, or it errors, the same call runs on the main thread with identical results. A request with no answer after 90 s fails with a plain message (never one that contains input). The secret input crosses to the worker as a transferred copy of an `ArrayBuffer` that the worker overwrites with zeros after use; the derived key comes back as a transferred buffer, and callers zero it once imported as a non-extractable key, as before. The worker re-checks parameter ceilings and never forwards an exception message. Measured in a production build, a main-thread derivation produced long tasks of roughly 90 to 200 ms (about 0.6 to 1.5 s under 6x CPU throttling); with the worker no long task overlaps a derivation.
* **Worker and CSP.** The per-request policy sets `worker-src 'self'`: with `'strict-dynamic'` browsers ignore `'self'` in `script-src`, so without it the same-origin worker would be blocked. Nothing else was loosened (no `blob:`, no remote hosts). The worker script is a static file the proxy does not cover, so `next.config.ts` serves `/_next/static/*` with its own policy (`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`), which a browser applies to the worker itself: the code that handles passphrase bytes cannot make a network request, even if it were compromised.
* **Automatic upgrade on unlock.** When a vault whose `kdfAlgorithm` is `PBKDF2-SHA256-*` is unlocked with the owner's passphrase, the browser (`lib/crypto/kdf-upgrade.ts`) wraps the SAME Vault Master Key under a new key-encryption key derived from the same passphrase with Argon2id (`ARGON2ID-19456-2-1`) and a fresh 16-byte random salt and nonce. Before anything is sent it unwraps the new bundle with the passphrase and requires a byte-identical key (compared by SHA-256) and, if the vault has an item, that the item still decrypts with the recovered key; if any check fails nothing is sent. The request (`UPGRADE_VAULT_KDF` on `POST /api/dashboard`) names the exact old algorithm, wrapped-key ciphertext and key version it started from. The server (`lib/services/vault-kdf-upgrade.ts`) validates it strictly (zero-knowledge payload check, unknown fields refused, only an Argon2id identifier inside the accepted envelope can be stored, exact 48-byte wrapped key, 12-byte nonce, 16-byte or longer salt, the starting point must be a PBKDF2 vault so a vault can never be downgraded), applies the same-origin check and the dashboard mutation rate limit, takes the owner from the session, and then performs one conditional `UPDATE` that changes the row only if it still has that algorithm, ciphertext and key version, in the same transaction as a `VAULT_KDF_UPGRADED` audit event (algorithm names only). Exactly one of any number of racing tabs or devices wins; the others get a 409 and change nothing, so a newer wrap is never overwritten. Item ciphertexts and wrapped item keys hang off the VMK, not the passphrase key, and the recovery artifact wraps the VMK under the recovery code, so none of them change and the recovery kit keeps working (proved by unit, database and browser tests). The upgrade also applies to short passphrases created under the old 8-character rule: the new-passphrase length rule does not apply to a passphrase that already opens the vault. A failed upgrade (network, server refusal, derivation error) is never shown as an error: the vault stays unlocked and unchanged and the next unlock retries. After a success the owner sees "Your vault now uses stronger protection." Vaults unlocked only with the recovery code are not upgraded (there is no passphrase to derive from) and recovery kits themselves keep their original algorithm; replacing a kit already creates an Argon2id one. Remaining exposure: until a vault is next unlocked with its passphrase it stays on PBKDF2-SHA256 (600,000 iterations, the OWASP minimum for that algorithm).
* **What is deliberately unchanged.** The 128-bit AES-GCM wrapping, HKDF subkeys and AAD layout are untouched. The 16-hex-character recovery `fingerprintHex` is a non-cryptographic checksum of the recovery code that the server stores; it reveals at most 64 bits of a 160-bit secret, which does not make the code guessable, but it should not be treated as a secret-free value.

### Server-Side Only (Next.js API + Neon PostgreSQL)
1. User authentication and session lifecycle, owned by **Neon Auth (Managed Better Auth)**: email and password plus Google sign-in. Dusk maps each Neon Auth identity to a Dusk user and links existing accounts only by a *verified* email, so an attacker who signs up with someone else's address cannot take over their account.
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