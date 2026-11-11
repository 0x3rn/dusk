// app/(marketing)/security/technical-details.tsx
// The exact methods and settings, for readers who want to check our work. Every statement here is
// taken from the code (lib/crypto, lib/engine, lib/services). The plain-language version of the
// same facts is on the page above it, so keep the two in step.
import React from "react";
import Link from "next/link";

function Sub({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="space-y-3 scroll-mt-24">
      <h3 className="text-xl font-semibold tracking-tight text-foreground">{title}</h3>
      {children}
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[16px] leading-relaxed text-foreground-secondary">{children}</p>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-[4px] bg-hover px-1 py-0.5 font-mono text-[0.875em] text-foreground break-words">
    {children}
  </code>
);

function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-[16px] leading-relaxed text-foreground-secondary marker:text-foreground-muted">
      {children}
    </ul>
  );
}

const RELEASE_STEPS: ReadonlyArray<{ plain: string; state: string; rule: string }> = [
  {
    plain: "Counting down",
    state: "HEALTHY, REMINDER_DUE",
    rule: "Normal countdown to your next check-in. A reminder email goes out before the due date. Any check-in resets the timer.",
  },
  {
    plain: "Grace period",
    state: "GRACE_PERIOD",
    rule: "The due date has passed. A buffer you set (14 days by default) with more reminders. It moves on only after at least one reminder has been sent.",
  },
  {
    plain: "Final warnings",
    state: "ESCALATION_PENDING",
    rule: "Seven more days of stronger reminders. It moves on only when enough reminders were sent (3 by default, never fewer than 2) and at least one is confirmed delivered, so an email outage cannot start a release.",
  },
  {
    plain: "Asking your trusted verifiers",
    state: "VERIFICATION_REQUIRED",
    rule: "Each verifier gets a private link that lasts 14 days. They can say you are alive (this stops the process) or approve the release. The number of different verifiers who must approve is your setting (1 by default).",
  },
  {
    plain: "On hold",
    state: "RELEASE_HOLD",
    rule: "You or a verifier froze the process. Nothing can be released until it is lifted.",
  },
  {
    plain: "Released",
    state: "RELEASED",
    rule: "Every rule below passed. Each beneficiary is emailed a single-use access link that lasts 48 hours.",
  },
  {
    plain: "Paused or stopped",
    state: "PAUSED, CANCELED",
    rule: "You paused the plan, or cancelled a false alarm. No release can happen from these states.",
  },
];

export function TechnicalDetails() {
  return (
    <section id="technical-details" aria-labelledby="technical-details-heading" className="space-y-10 scroll-mt-24">
      <div className="space-y-4 border-t border-border pt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary">For curious readers</p>
        <h2 id="technical-details-heading" className="text-3xl font-semibold tracking-tight text-foreground">
          Technical details
        </h2>
        <p className="max-w-prose text-[16px] leading-relaxed text-foreground-secondary">
          You do not need this part to use Dusk. It names the exact methods and settings in our code, for people who want to
          check our work. Everything above is the plain-language version of the same facts.
        </p>
      </div>

      <Sub title="Where encryption happens">
        <P>
          Key creation, key derivation, and the encryption and decryption of items, files and folder names all happen in
          your browser, using the standard Web Crypto API (<Code>crypto.subtle</Code>). Plaintext is never sent to Dusk.
        </P>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-brand/25 bg-accent-surface/40 p-5 space-y-3 min-w-0">
            <h4 className="font-semibold text-foreground">Stays on your device</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-foreground-secondary marker:text-foreground-muted">
              <li>Your master passphrase</li>
              <li>The vault master key, and every item and file key, unwrapped</li>
              <li>Titles, credentials, notes, file names and folder names, as plain text</li>
              <li>Your recovery code</li>
              <li>A beneficiary&apos;s private key</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3 min-w-0">
            <h4 className="font-semibold text-foreground">Stored by Dusk (in our PostgreSQL database)</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-foreground-secondary marker:text-foreground-muted">
              <li>Encrypted items, files and folder names, with their random initialisation values</li>
              <li>Wrapped (encrypted) keys and the salts used to derive keys</li>
              <li>Each beneficiary&apos;s public key, and the keys wrapped for them</li>
              <li>Your check-in settings and where the plan stands</li>
              <li>SHA-256 digests of links we emailed (never the links themselves)</li>
              <li>Activity records with secrets removed, kept for 12 months</li>
            </ul>
          </div>
        </div>
      </Sub>

      <Sub title="Key hierarchy">
        <P>
          Items are not encrypted with your passphrase directly. A chain of keys lets you change your passphrase, restore
          from a recovery kit, and share single items, without re-encrypting the whole vault.
        </P>
        <pre
          tabIndex={0}
          aria-label="Key hierarchy diagram"
          className="overflow-x-auto rounded-2xl border border-border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground sm:text-sm"
        >
          {`[master passphrase] + [random salt, 16 bytes or more]
  └─ Argon2id (new vaults)  or  PBKDF2-HMAC-SHA256, 600,000 iterations (earlier vaults)
       └─ 256-bit passphrase key
            └─ AES-256-GCM wraps ─► 256-bit vault master key (VMK)
                 ├─ HKDF-SHA256 "dusk-v1-item-kek"   ─► wraps each item key
                 ├─ HKDF-SHA256 "dusk-v1-file-kek"   ─► wraps each file key
                 └─ HKDF-SHA256 "dusk-v1-folder-key" ─► encrypts folder names`}
        </pre>
      </Sub>

      <Sub title="Turning your passphrase into a key">
        <Bullets>
          <li>
            New vaults and new recovery kits use <strong className="text-foreground">Argon2id</strong> with 19 MiB of memory, 2
            passes and 1 lane (the OWASP minimum recommendation).
          </li>
          <li>
            Vaults made earlier used <strong className="text-foreground">PBKDF2-HMAC-SHA256</strong> with 600,000 iterations
            (recovery kits made earlier: 310,000). They keep opening with the same passphrase, and they upgrade themselves
            the next time they are unlocked.
          </li>
          <li>
            The settings are stored next to the wrapped key and come back from the server when you unlock, so your browser
            checks them first. It refuses anything weaker than Dusk&apos;s own defaults, and anything heavy enough to freeze
            a phone.
          </li>
          <li>A new master passphrase must have at least 12 characters. Unlocking never checks length, so older vaults still open.</li>
        </Bullets>
      </Sub>

      <Sub title="Encrypting items and files">
        <Bullets>
          <li>
            AES-256-GCM, with a fresh random 96-bit value for every encryption. Each item and file has its own random 256-bit
            key, wrapped under a subkey of the vault master key.
          </li>
          <li>
            The authentication tag also covers a label naming the vault, the kind of thing, its id and the key version:{" "}
            <Code>dusk-aad-v1|vaultId|resourceType|resourceId|kv:N</Code>. Moving a ciphertext into another item or another
            vault makes decryption fail.
          </li>
        </Bullets>
      </Sub>

      <Sub title="Recovery kit">
        <P>
          Your vault master key is wrapped a second time under a random recovery code (<Code>DUSK-XXXX-...</Code>, in
          Crockford Base32) that you keep offline, optionally with a kit passphrase mixed in. Dusk stores only the wrapped copy and a public
          fingerprint so you can tell which kit matches. Dusk can&apos;t use it.
        </P>
      </Sub>

      <Sub title="Giving items to a beneficiary">
        <Bullets>
          <li>
            Each beneficiary has an <strong className="text-foreground">ECDH P-256</strong> key pair. Dusk stores only the
            public key. The private key stays in the private link or key file you give them, and is never sent to Dusk.
          </li>
          <li>
            When you assign an item, your browser makes a one-time key pair, agrees a shared secret with the beneficiary&apos;s
            public key, turns it into a wrapping key with HKDF-SHA256, and wraps only that item&apos;s key with AES-256-GCM.
          </li>
          <li>
            The beneficiary never receives your vault master key, and cannot open items you did not assign to them.
          </li>
          <li>
            Dusk sends no referrer (<Code>Referrer-Policy: no-referrer</Code>), so the link is not
            passed on to other sites.
          </li>
        </Bullets>
      </Sub>

      <Sub id="release-rules" title="Release rules in detail">
        <P>
          A scheduler runs every 15 minutes. Each step it takes is keyed in the database, so a repeated or late run changes
          nothing twice. The names below are the internal state names used in our code and logs.
        </P>
        <ul className="space-y-3">
          {RELEASE_STEPS.map((step) => (
            <li key={step.state} className="rounded-xl border border-border bg-card p-4 min-w-0">
              <p className="font-semibold text-foreground">{step.plain}</p>
              <p className="mt-0.5 text-xs font-mono text-accent-text break-words">{step.state}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-foreground-secondary">{step.rule}</p>
            </li>
          ))}
        </ul>
        <P>
          The final release check <strong className="text-foreground">fails closed</strong>: if any condition is missing or
          unclear, the answer is no. It refuses unless all of these are true: the plan is in the verification stage; the grace
          period has passed; enough reminders were sent and at least one was confirmed delivered; enough different verifiers
          approved; nobody has placed a hold or said you are alive; the plan is not paused or cancelled; and you have not
          checked in since the due date.
        </P>
      </Sub>

      <Sub title="Links and tokens">
        <Bullets>
          <li>Links are random 256-bit values. Only their SHA-256 digest is stored, so a copy of the database holds no usable link.</li>
          <li>Check-in links expire after 72 hours and work once. Verifier links expire after 14 days.</li>
          <li>Beneficiary access links expire after 48 hours and work once, and are tied to one person.</li>
          <li>Opening and answering links is rate limited, so guessing is impractical.</li>
        </Bullets>
      </Sub>

      <Sub title="Sign-in and sessions">
        <P>
          Sign-in is run by Neon Auth. Dusk does not store your password. Changing your password and deleting your account
          each need a 6-digit code emailed to your address, and the server checks that code itself. A signed-out or revoked
          device loses access within about a second.
        </P>
      </Sub>

      <Sub title="Browser protections">
        <P>
          Pages carry a Content Security Policy with a fresh random nonce on every request, <Code>frame-ancestors</Code> set
          to none, HSTS, and <Code>nosniff</Code>. Every request that changes data must come from our own site (checked by
          origin), and is rate limited per account.
        </P>
      </Sub>

      <Sub title="Records and deleting your data">
        <P>
          Activity records are saved with secrets removed and deleted automatically after 12 months. You can delete your
          account in Settings, and it is removed straight away. The privacy policy lists exactly what we keep and for how
          long: <Link href="/privacy#how-long-we-keep-it" className="text-accent-text underline underline-offset-2">how long we keep your information</Link>.
        </P>
      </Sub>
    </section>
  );
}
