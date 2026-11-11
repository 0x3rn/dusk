// lib/crypto/kdf-worker-core.ts
//
// The message protocol between the page and the key-derivation Web Worker, plus the pure request
// handler the worker runs. Kept free of any `self`/`Worker` reference so it is unit tested in
// Node; ./kdf.worker.ts is only the thin entry that wires it to postMessage.
//
// Secrets: the passphrase-derived input crosses as a transferred ArrayBuffer (moved, not copied
// back to the page) and the worker overwrites it with zeros as soon as the key is derived. The
// derived key comes back as a transferred ArrayBuffer too. Nothing else is ever sent back: error
// replies carry a fixed "kind" and, for parameter errors, the numbers-only detail text, never an
// arbitrary exception message (those could echo input).

import { KdfParameterError, deriveKeyBytesOnThisThread, type KdfParams } from "./kdf";

export const KDF_WORKER_PROTOCOL_VERSION = 1;

export interface KdfWorkerRequest {
  v: typeof KDF_WORKER_PROTOCOL_VERSION;
  type: "derive";
  /** Chosen by the page, echoed in the reply so concurrent requests cannot be mixed up. */
  id: number;
  params: KdfParams;
  /** Secret input (passphrase bytes, or recovery code + passphrase). Transferred. */
  secret: ArrayBuffer;
  salt: ArrayBuffer;
}

export type KdfWorkerErrorKind =
  /** The parameters were refused (out of range, malformed). `detail` explains which. */
  | "parameters"
  /** Anything else went wrong while deriving. No detail is sent. */
  | "failed";

export type KdfWorkerReply =
  /** Sent once when the worker script has started, so the page knows it was not blocked. */
  | { v: typeof KDF_WORKER_PROTOCOL_VERSION; type: "ready" }
  | { v: typeof KDF_WORKER_PROTOCOL_VERSION; type: "result"; id: number; key: ArrayBuffer }
  | {
      v: typeof KDF_WORKER_PROTOCOL_VERSION;
      type: "error";
      id: number;
      kind: KdfWorkerErrorKind;
      detail?: string;
    };

export const KDF_WORKER_READY: KdfWorkerReply = { v: KDF_WORKER_PROTOCOL_VERSION, type: "ready" };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Runtime check of an untrusted `params` value (types alone do not survive postMessage). */
export function parseKdfWorkerParams(value: unknown): KdfParams {
  if (typeof value !== "object" || value === null) {
    throw new KdfParameterError("KDF parameters are missing.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.algorithm === "ARGON2ID") {
    if (
      !isPositiveSafeInteger(candidate.memoryKiB) ||
      !isPositiveSafeInteger(candidate.timeCost) ||
      !isPositiveSafeInteger(candidate.parallelism)
    ) {
      throw new KdfParameterError("Argon2id parameters must be positive whole numbers.");
    }
    return {
      algorithm: "ARGON2ID",
      memoryKiB: candidate.memoryKiB,
      timeCost: candidate.timeCost,
      parallelism: candidate.parallelism,
    };
  }
  if (candidate.algorithm === "PBKDF2-SHA256") {
    if (!isPositiveSafeInteger(candidate.iterations)) {
      throw new KdfParameterError("PBKDF2 iterations must be a positive whole number.");
    }
    return { algorithm: "PBKDF2-SHA256", iterations: candidate.iterations };
  }
  throw new KdfParameterError("Unknown key-derivation algorithm.");
}

/** Hard cap on the secret input: the longest passphrase plus a recovery code, in UTF-8. */
const MAX_SECRET_BYTES = 16 * 1024;

function isRequest(message: unknown): message is KdfWorkerRequest {
  if (typeof message !== "object" || message === null) return false;
  const m = message as Record<string, unknown>;
  return (
    m.v === KDF_WORKER_PROTOCOL_VERSION &&
    m.type === "derive" &&
    typeof m.id === "number" &&
    Number.isSafeInteger(m.id) &&
    m.secret instanceof ArrayBuffer &&
    m.salt instanceof ArrayBuffer
  );
}

export interface KdfWorkerHandled {
  reply: KdfWorkerReply;
  /** Buffers to hand over (not copy) when posting the reply. */
  transfer: ArrayBuffer[];
}

/**
 * Handles one message. Never throws and never returns the secret: whatever happens, the secret
 * buffer is zeroed before this resolves.
 */
export async function handleKdfWorkerMessage(message: unknown): Promise<KdfWorkerHandled | null> {
  if (!isRequest(message)) return null; // not ours: ignore, there is no id to reply to

  const { id } = message;
  const secret = new Uint8Array(message.secret);
  try {
    if (secret.byteLength === 0 || secret.byteLength > MAX_SECRET_BYTES) {
      throw new KdfParameterError("The secret input has an unexpected size.");
    }
    const params = parseKdfWorkerParams(message.params);
    const salt = new Uint8Array(message.salt);
    const key = await deriveKeyBytesOnThisThread(params, secret, salt);
    // A fresh buffer so exactly the 32 derived bytes are transferred.
    const out = new Uint8Array(key.byteLength);
    out.set(key);
    key.fill(0);
    return {
      reply: { v: KDF_WORKER_PROTOCOL_VERSION, type: "result", id, key: out.buffer as ArrayBuffer },
      transfer: [out.buffer as ArrayBuffer],
    };
  } catch (err) {
    if (err instanceof KdfParameterError) {
      return {
        reply: { v: KDF_WORKER_PROTOCOL_VERSION, type: "error", id, kind: "parameters", detail: err.detail },
        transfer: [],
      };
    }
    return { reply: { v: KDF_WORKER_PROTOCOL_VERSION, type: "error", id, kind: "failed" }, transfer: [] };
  } finally {
    secret.fill(0);
  }
}
