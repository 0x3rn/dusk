// lib/crypto/kdf-client.ts
//
// The one async entry point for password-based key derivation: deriveKeyBytes(). In a browser it
// runs Argon2id / PBKDF2 inside a dedicated Web Worker so the page stays responsive while a vault
// is created or unlocked (the derivation takes 0.1 to 1 s of solid computation). Where a worker
// cannot be used (no Worker or WebAssembly, tests in Node, a blocked or broken worker) the same
// call runs on the calling thread with identical results, so callers never branch.
//
// Lifecycle: the worker is created on the first request, shared by concurrent requests (matched
// by request id), and terminated after a period with nothing to do so its WebAssembly memory is
// released. Timeouts: a worker that never starts within the startup window is abandoned and the
// work runs inline; a request that gets no answer within the request window fails with a plain
// message and the worker is replaced on the next call.
//
// Secrets: the caller's bytes are never moved. The client sends a COPY as a transferable
// ArrayBuffer; the worker zeroes it after use. Callers keep zeroing their own bytes, as before.

import {
  KDF_MIN_SALT_BYTES,
  KdfParameterError,
  deriveKeyBytesOnThisThread,
  type KdfParams,
} from "./kdf";
import {
  KDF_WORKER_PROTOCOL_VERSION,
  type KdfWorkerReply,
  type KdfWorkerRequest,
} from "./kdf-worker-core";

/** The key derivation could not finish (timed out or failed inside the worker). */
export class KdfDerivationError extends Error {
  public readonly code = "KDF_DERIVATION_FAILED";
  public readonly reason: "timeout" | "failed";
  constructor(reason: "timeout" | "failed") {
    super(
      reason === "timeout"
        ? "Securing your passphrase is taking longer than expected. Refresh the page and try again."
        : "We couldn't process your passphrase on this device. Refresh the page and try again."
    );
    this.name = "KdfDerivationError";
    this.reason = reason;
  }
}

/** The subset of the Web Worker API the client uses; lets tests supply a fake. */
export interface KdfWorkerLike {
  postMessage(message: KdfWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<KdfWorkerReply>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: Event) => void) | null;
}

export interface KdfClientOptions {
  /** Returns a new worker, or null when workers are not available. Default: the real worker. */
  createWorker?: () => KdfWorkerLike | null;
  /** The main-thread derivation used as the fallback. Default: the real core. */
  runInline?: (params: KdfParams, secret: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>;
  /** Longest a single request may wait for an answer. */
  requestTimeoutMs?: number;
  /** Longest a new worker may take to start before it is abandoned for the main thread. */
  startupTimeoutMs?: number;
  /** How long the worker lives with nothing to do. */
  idleTimeoutMs?: number;
}

export interface KdfClient {
  deriveKeyBytes(params: KdfParams, secretBytes: Uint8Array, salt: Uint8Array): Promise<Uint8Array>;
  /** Stops the worker now. A later call starts a fresh one (unless workers proved unusable). */
  dispose(): void;
  /** For diagnostics and tests. */
  status(): { workerAlive: boolean; workerUnusable: boolean; pending: number };
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (key: Uint8Array) => void;
  reject: (error: unknown) => void;
  params: KdfParams;
  secret: Uint8Array;
  salt: Uint8Array;
  timer: ReturnType<typeof setTimeout>;
}

/** The real worker. The `new URL(..., import.meta.url)` form is what the bundler detects. */
function createBrowserWorker(): KdfWorkerLike | null {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return null;
  try {
    return new Worker(new URL("./kdf.worker.ts", import.meta.url)) as unknown as KdfWorkerLike;
  } catch (err) {
    console.warn(
      "Key derivation worker could not start; using the main thread.",
      err instanceof Error ? err.name : "unknown"
    );
    return null;
  }
}

export function createKdfClient(options: KdfClientOptions = {}): KdfClient {
  const createWorker = options.createWorker ?? createBrowserWorker;
  const runInline = options.runInline ?? deriveKeyBytesOnThisThread;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  let worker: KdfWorkerLike | null = null;
  let workerUnusable = false;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function clearIdleTimer(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function clearStartupTimer(): void {
    if (startupTimer !== null) clearTimeout(startupTimer);
    startupTimer = null;
  }

  function stopWorker(): void {
    clearIdleTimer();
    clearStartupTimer();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
  }

  function scheduleIdleStop(): void {
    clearIdleTimer();
    if (!worker || pending.size > 0) return;
    idleTimer = setTimeout(() => {
      if (pending.size === 0) stopWorker();
    }, idleTimeoutMs);
  }

  function takePending(id: number): Pending | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  }

  function takeAllPending(): Pending[] {
    return [...pending.keys()].map((id) => takePending(id)).filter((e): e is Pending => e !== undefined);
  }

  /** The worker is broken or blocked: remember that and finish every waiting request inline. */
  function abandonWorker(): void {
    workerUnusable = true;
    stopWorker();
    for (const entry of takeAllPending()) {
      runInline(entry.params, entry.secret, entry.salt).then(entry.resolve, entry.reject);
    }
  }

  /** A request got no answer in time: fail everything waiting and drop the (stuck) worker. */
  function failAllAsTimedOut(): void {
    stopWorker();
    for (const entry of takeAllPending()) entry.reject(new KdfDerivationError("timeout"));
  }

  function handleReply(reply: KdfWorkerReply): void {
    if (!reply || reply.v !== KDF_WORKER_PROTOCOL_VERSION) return;
    clearStartupTimer();
    if (reply.type === "ready") return;
    const entry = takePending(reply.id);
    if (!entry) return; // a late answer for a request that already ended
    if (reply.type === "result") {
      entry.resolve(new Uint8Array(reply.key));
    } else if (reply.kind === "parameters") {
      entry.reject(new KdfParameterError(reply.detail ?? "The key settings were refused."));
    } else {
      entry.reject(new KdfDerivationError("failed"));
    }
    scheduleIdleStop();
  }

  function ensureWorker(): KdfWorkerLike | null {
    if (workerUnusable) return null;
    clearIdleTimer();
    if (worker) return worker;

    const created = createWorker();
    if (!created) {
      workerUnusable = true;
      return null;
    }
    created.onmessage = (event) => handleReply(event.data);
    created.onerror = () => abandonWorker();
    created.onmessageerror = () => abandonWorker();
    worker = created;
    startupTimer = setTimeout(abandonWorker, startupTimeoutMs);
    return created;
  }

  return {
    async deriveKeyBytes(params, secretBytes, salt) {
      if (salt.byteLength < KDF_MIN_SALT_BYTES) {
        throw new KdfParameterError(`KDF salt must be at least ${KDF_MIN_SALT_BYTES} bytes.`);
      }
      const active = ensureWorker();
      if (!active) return runInline(params, secretBytes, salt);

      return new Promise<Uint8Array>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(failAllAsTimedOut, requestTimeoutMs);
        pending.set(id, { resolve, reject, params, secret: secretBytes, salt, timer });

        // Copies are transferred (moved into the worker); the caller's own bytes stay put so the
        // main-thread fallback can still use them, and the caller zeroes them as it always did.
        const secretCopy = secretBytes.slice().buffer as ArrayBuffer;
        const saltCopy = salt.slice().buffer as ArrayBuffer;
        const request: KdfWorkerRequest = {
          v: KDF_WORKER_PROTOCOL_VERSION,
          type: "derive",
          id,
          params,
          secret: secretCopy,
          salt: saltCopy,
        };
        try {
          active.postMessage(request, [secretCopy, saltCopy]);
        } catch {
          // The worker could not take the message: finish this request, and any other, inline.
          abandonWorker();
        }
      });
    },

    dispose() {
      stopWorker();
    },

    status() {
      return { workerAlive: worker !== null, workerUnusable, pending: pending.size };
    },
  };
}

let defaultClient: KdfClient | null = null;

function getDefaultClient(): KdfClient {
  defaultClient ??= createKdfClient();
  return defaultClient;
}

/**
 * Derives 32 bytes of key material from secret bytes and a salt. The parameters must already have
 * been validated (parseKdfAlgorithm / assertKdfParamsAcceptable). Runs in a Web Worker where
 * possible. Callers should zero the returned bytes once they are imported as a key.
 */
export function deriveKeyBytes(params: KdfParams, secretBytes: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  return getDefaultClient().deriveKeyBytes(params, secretBytes, salt);
}

/** Stops the shared worker immediately (it also stops itself when idle). */
export function disposeKdfWorker(): void {
  defaultClient?.dispose();
}
