// lib/crypto/kdf.ts
//
// Password-based key derivation for the vault passphrase and the recovery kit, with a versioned
// algorithm identifier that is stored next to the wrapped key (Vault.kdfAlgorithm and
// RecoveryArtifact.kdfAlgorithm) and is the ONLY source of the parameters used to derive a key.
//
//   ARGON2ID-<memoryKiB>-<timeCost>-<parallelism>   e.g. ARGON2ID-19456-2-1 (new vaults)
//   PBKDF2-SHA256-<iterations>                        e.g. PBKDF2-SHA256-600000 (existing vaults)
//   ...+PASSPHRASE                                    recovery kits only: a kit passphrase was used
//
// The identifier comes back from the server when a vault is unlocked, so it is untrusted input.
// parseKdfAlgorithm() only accepts a narrow, documented envelope: nothing that would hang or crash
// the browser (a hostile server asking for 4 GiB of memory) and nothing weaker than what Dusk
// itself would have created. Anything else is rejected with KdfParameterError before any work is
// done. A tampered-but-accepted identifier still cannot weaken a vault: the derived key changes
// with every parameter, so the wrapped key fails its authentication check instead of opening.

/** Argon2id parameters recommended by OWASP: 19 MiB of memory, 2 passes, 1 lane. */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  algorithm: "ARGON2ID",
  memoryKiB: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Identifier written for every newly created vault and recovery kit. */
export const ARGON2ID_DEFAULT_ALGORITHM_ID = "ARGON2ID-19456-2-1";

/** Identifier of vaults created before Argon2id was introduced. They keep unlocking unchanged. */
export const LEGACY_VAULT_PBKDF2_ALGORITHM_ID = "PBKDF2-SHA256-600000";

/** Identifier of recovery kits created before Argon2id was introduced. */
export const LEGACY_RECOVERY_PBKDF2_ALGORITHM_ID = "PBKDF2-SHA256-310000";

export const KDF_OUTPUT_BYTES = 32;
export const KDF_MIN_SALT_BYTES = 16;

/**
 * Accepted parameter envelope. The floor is the OWASP minimum (never weaker than Dusk's own
 * defaults); the ceiling keeps a hostile server from stalling or crashing a phone.
 */
export const KDF_LIMITS = {
  argon2id: {
    minMemoryKiB: 19_456,
    maxMemoryKiB: 65_536,
    minTimeCost: 2,
    maxTimeCost: 6,
    minParallelism: 1,
    maxParallelism: 4,
  },
  pbkdf2: {
    vaultMinIterations: 600_000,
    recoveryMinIterations: 310_000,
    maxIterations: 1_000_000,
  },
} as const;

export type KdfPurpose = "vault-passphrase" | "recovery-kit";

export interface Argon2idParams {
  algorithm: "ARGON2ID";
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
}

export interface Pbkdf2Params {
  algorithm: "PBKDF2-SHA256";
  iterations: number;
}

export type KdfParams = Argon2idParams | Pbkdf2Params;

export interface ParsedKdfAlgorithm {
  params: KdfParams;
  /** True when a recovery kit's identifier says a kit passphrase was mixed into the key. */
  usesKitPassphrase: boolean;
}

/**
 * Tuning knob for tests only: lets unit tests use a cheap PBKDF2 so the suite stays fast. Real
 * code never passes it, so the production floor above always applies.
 */
export interface KdfPolicy {
  pbkdf2MinIterations?: number;
}

export class KdfParameterError extends Error {
  public readonly code = "KDF_PARAMETERS_REJECTED";
  /** Developer-facing reason. Not shown to people. */
  public readonly detail: string;
  constructor(detail: string) {
    super(
      "This vault uses key settings that Dusk does not accept, so it was not opened. Refresh the page and try again. If it keeps happening, contact support."
    );
    this.name = "KdfParameterError";
    this.detail = detail;
  }
}

const MAX_IDENTIFIER_LENGTH = 64;
const KIT_PASSPHRASE_SUFFIX = "+PASSPHRASE";
// No leading zeros, bounded length: the same numbers always have exactly one spelling.
const PBKDF2_PATTERN = /^PBKDF2-SHA256-([1-9][0-9]{0,8})$/;
const ARGON2ID_PATTERN = /^ARGON2ID-([1-9][0-9]{0,8})-([1-9][0-9]{0,3})-([1-9][0-9]{0,3})$/;

function assertWithin(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new KdfParameterError(`${name}=${value} is outside the accepted range ${min}..${max}.`);
  }
}

/** Checks parameter values (not text). Used both when parsing and before creating a vault. */
export function assertKdfParamsAcceptable(
  params: KdfParams,
  purpose: KdfPurpose,
  policy: KdfPolicy = {}
): void {
  if (params.algorithm === "ARGON2ID") {
    const l = KDF_LIMITS.argon2id;
    assertWithin("Argon2id memory (KiB)", params.memoryKiB, l.minMemoryKiB, l.maxMemoryKiB);
    assertWithin("Argon2id time cost", params.timeCost, l.minTimeCost, l.maxTimeCost);
    assertWithin("Argon2id parallelism", params.parallelism, l.minParallelism, l.maxParallelism);
    return;
  }
  const l = KDF_LIMITS.pbkdf2;
  const floor =
    policy.pbkdf2MinIterations ??
    (purpose === "vault-passphrase" ? l.vaultMinIterations : l.recoveryMinIterations);
  assertWithin("PBKDF2 iterations", params.iterations, floor, l.maxIterations);
}

/**
 * Turns a stored algorithm identifier into validated parameters. Throws KdfParameterError for
 * anything unknown, malformed, out of range or not allowed for the purpose.
 */
export function parseKdfAlgorithm(
  identifier: string,
  purpose: KdfPurpose,
  policy: KdfPolicy = {}
): ParsedKdfAlgorithm {
  if (typeof identifier !== "string" || identifier.length === 0 || identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new KdfParameterError("The algorithm identifier is missing or too long.");
  }

  let core = identifier;
  let usesKitPassphrase = false;
  if (core.endsWith(KIT_PASSPHRASE_SUFFIX)) {
    if (purpose !== "recovery-kit") {
      throw new KdfParameterError("A vault passphrase identifier cannot carry the kit-passphrase suffix.");
    }
    core = core.slice(0, -KIT_PASSPHRASE_SUFFIX.length);
    usesKitPassphrase = true;
  }

  const argon = ARGON2ID_PATTERN.exec(core);
  if (argon) {
    const params: Argon2idParams = {
      algorithm: "ARGON2ID",
      memoryKiB: Number(argon[1]),
      timeCost: Number(argon[2]),
      parallelism: Number(argon[3]),
    };
    assertKdfParamsAcceptable(params, purpose, policy);
    return { params, usesKitPassphrase };
  }

  const pbkdf2 = PBKDF2_PATTERN.exec(core);
  if (pbkdf2) {
    const params: Pbkdf2Params = { algorithm: "PBKDF2-SHA256", iterations: Number(pbkdf2[1]) };
    assertKdfParamsAcceptable(params, purpose, policy);
    return { params, usesKitPassphrase };
  }

  throw new KdfParameterError("The algorithm identifier is not a known Dusk key-derivation algorithm.");
}

/**
 * True when the identifier would be accepted by parseKdfAlgorithm. Used by the server to refuse
 * unknown or weak identifiers when a vault or recovery kit is stored.
 */
export function isAcceptableKdfAlgorithm(identifier: string, purpose: KdfPurpose): boolean {
  try {
    parseKdfAlgorithm(identifier, purpose);
    return true;
  } catch (err) {
    if (err instanceof KdfParameterError) return false;
    throw err;
  }
}

/** The identifier to store for the given parameters. Always matches what deriveKeyBytes() runs. */
export function formatKdfAlgorithm(params: KdfParams, options: { kitPassphrase?: boolean } = {}): string {
  const core =
    params.algorithm === "ARGON2ID"
      ? `ARGON2ID-${params.memoryKiB}-${params.timeCost}-${params.parallelism}`
      : `PBKDF2-SHA256-${params.iterations}`;
  return options.kitPassphrase ? `${core}${KIT_PASSPHRASE_SUFFIX}` : core;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Argon2id (RFC 9106) through hash-wasm, a WebAssembly build with no native modules and no
 * dependencies. Exported separately so it can be tested against published vectors.
 * The library is loaded on first use, so pages that never derive a key do not download it.
 */
export async function argon2idDerive(input: {
  password: Uint8Array;
  salt: Uint8Array;
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
  outputBytes?: number;
  /** Optional keyed-hash secret from RFC 9106. Dusk does not use it; kept for test vectors. */
  secret?: Uint8Array;
}): Promise<Uint8Array> {
  // Hard stop on absurd values even when called directly (the identifier parser has stricter
  // limits). 256 MiB is far beyond anything Dusk configures but still bounded.
  assertWithin("Argon2id memory (KiB)", input.memoryKiB, 8, 262_144);
  assertWithin("Argon2id time cost", input.timeCost, 1, 16);
  assertWithin("Argon2id parallelism", input.parallelism, 1, 16);
  if (input.salt.byteLength < 8) throw new KdfParameterError("Argon2id salt must be at least 8 bytes.");

  const { argon2id } = await import("hash-wasm");
  return argon2id({
    password: input.password,
    salt: input.salt,
    secret: input.secret,
    memorySize: input.memoryKiB,
    iterations: input.timeCost,
    parallelism: input.parallelism,
    hashLength: input.outputBytes ?? KDF_OUTPUT_BYTES,
    outputType: "binary",
  });
}

/**
 * Derives 32 bytes of key material from secret bytes and a salt with the given (already
 * validated) parameters. Callers should zero the returned bytes once they are imported as a key.
 */
export async function deriveKeyBytes(
  params: KdfParams,
  secretBytes: Uint8Array,
  salt: Uint8Array
): Promise<Uint8Array> {
  if (salt.byteLength < KDF_MIN_SALT_BYTES) {
    throw new KdfParameterError(`KDF salt must be at least ${KDF_MIN_SALT_BYTES} bytes.`);
  }

  if (params.algorithm === "ARGON2ID") {
    return argon2idDerive({
      password: secretBytes,
      salt,
      memoryKiB: params.memoryKiB,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
    });
  }

  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey("raw", toArrayBuffer(secretBytes), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: params.iterations },
    baseKey,
    KDF_OUTPUT_BYTES * 8
  );
  return new Uint8Array(bits);
}
