// lib/crypto/kdf-client.test.ts
// The worker protocol and client lifecycle, tested in Node with an in-process fake worker that
// runs the REAL worker handler (so results are checked against the real derivation).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ARGON2ID_PARAMS, KdfParameterError, deriveKeyBytesOnThisThread, type KdfParams } from "./kdf";
import { KdfDerivationError, createKdfClient, deriveKeyBytes, type KdfWorkerLike } from "./kdf-client";
import {
  KDF_WORKER_PROTOCOL_VERSION,
  KDF_WORKER_READY,
  handleKdfWorkerMessage,
  parseKdfWorkerParams,
  type KdfWorkerReply,
  type KdfWorkerRequest,
} from "./kdf-worker-core";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);
const text = (value: string) => new TextEncoder().encode(value);
const PBKDF2: KdfParams = { algorithm: "PBKDF2-SHA256", iterations: 2_000 };

interface FakeWorkerOptions {
  /** Send "ready" when created. Default true. */
  announceReady?: boolean;
  /** Answer requests (default true). False simulates a worker that hangs. */
  answer?: boolean;
  /** Replace the handler to inject behaviour. */
  handle?: (request: KdfWorkerRequest) => Promise<KdfWorkerReply | null>;
}

class FakeWorker implements KdfWorkerLike {
  onmessage: ((event: MessageEvent<KdfWorkerReply>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  terminated = false;
  requests: KdfWorkerRequest[] = [];

  constructor(private readonly options: FakeWorkerOptions = {}) {
    if (options.announceReady !== false) {
      queueMicrotask(() => this.emit(KDF_WORKER_READY));
    }
  }

  emit(reply: KdfWorkerReply): void {
    if (this.terminated) return;
    this.onmessage?.({ data: reply } as MessageEvent<KdfWorkerReply>);
  }

  postMessage(message: KdfWorkerRequest, transfer: Transferable[]): void {
    expect(transfer).toContain(message.secret);
    expect(transfer).toContain(message.salt);
    this.requests.push(message);
    if (this.options.answer === false) return;
    void (async () => {
      const reply = this.options.handle
        ? await this.options.handle(message)
        : ((await handleKdfWorkerMessage(message))?.reply ?? null);
      if (reply) this.emit(reply);
    })();
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("worker core (handleKdfWorkerMessage)", () => {
  const request = (over: Partial<KdfWorkerRequest> = {}): KdfWorkerRequest => ({
    v: KDF_WORKER_PROTOCOL_VERSION,
    type: "derive",
    id: 7,
    params: PBKDF2,
    secret: text("a passphrase").buffer.slice(0) as ArrayBuffer,
    salt: filled(16, 3).buffer as ArrayBuffer,
    ...over,
  });

  it("derives the same bytes as the main-thread core, echoes the id and zeroes the secret", async () => {
    const message = request();
    const secretView = new Uint8Array(message.secret);
    const handled = await handleKdfWorkerMessage(message);
    expect(handled?.reply.type).toBe("result");
    if (handled?.reply.type !== "result") throw new Error("unreachable");
    expect(handled.reply.id).toBe(7);
    expect(handled.transfer).toEqual([handled.reply.key]);
    const expected = await deriveKeyBytesOnThisThread(PBKDF2, text("a passphrase"), filled(16, 3));
    expect(hex(new Uint8Array(handled.reply.key))).toBe(hex(expected));
    expect(secretView.every((b) => b === 0)).toBe(true);
  });

  it("ignores messages that are not requests (no reply, nothing thrown)", async () => {
    for (const junk of [null, undefined, 5, "x", {}, { v: 2, type: "derive", id: 1 }, { v: 1, type: "other", id: 1 }]) {
      expect(await handleKdfWorkerMessage(junk)).toBeNull();
    }
  });

  it("refuses bad parameters with a parameters error and still zeroes the secret", async () => {
    const bad: unknown[] = [
      { algorithm: "ARGON2ID", memoryKiB: 4_194_304, timeCost: 2, parallelism: 1 },
      { algorithm: "ARGON2ID", memoryKiB: 19_456, timeCost: 0, parallelism: 1 },
      { algorithm: "ARGON2ID", memoryKiB: "19456", timeCost: 2, parallelism: 1 },
      { algorithm: "PBKDF2-SHA256", iterations: 50_000_000 },
      { algorithm: "PBKDF2-SHA256", iterations: -1 },
      { algorithm: "SCRYPT" },
      null,
    ];
    for (const params of bad) {
      const message = request({ params: params as KdfParams });
      const secretView = new Uint8Array(message.secret);
      const handled = await handleKdfWorkerMessage(message);
      expect(handled?.reply).toMatchObject({ type: "error", kind: "parameters", id: 7 });
      expect(secretView.every((b) => b === 0)).toBe(true);
    }
  });

  it("refuses an empty or oversized secret and a short salt", async () => {
    const empty = await handleKdfWorkerMessage(request({ secret: new ArrayBuffer(0) }));
    expect(empty?.reply).toMatchObject({ type: "error", kind: "parameters" });
    const huge = await handleKdfWorkerMessage(request({ secret: new ArrayBuffer(20_000) }));
    expect(huge?.reply).toMatchObject({ type: "error", kind: "parameters" });
    const shortSalt = await handleKdfWorkerMessage(request({ salt: new ArrayBuffer(8) }));
    expect(shortSalt?.reply).toMatchObject({ type: "error", kind: "parameters" });
  });

  it("never forwards an arbitrary exception message (it could echo the passphrase)", async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, "importKey").mockRejectedValueOnce(new Error("secret-passphrase-leak"));
    try {
      const handled = await handleKdfWorkerMessage(request());
      expect(handled?.reply).toEqual({ v: KDF_WORKER_PROTOCOL_VERSION, type: "error", id: 7, kind: "failed" });
      expect(JSON.stringify(handled)).not.toContain("secret-passphrase-leak");
    } finally {
      spy.mockRestore();
    }
  });

  it("parseKdfWorkerParams returns only the known fields", () => {
    expect(parseKdfWorkerParams({ ...DEFAULT_ARGON2ID_PARAMS, extra: "x" })).toEqual(DEFAULT_ARGON2ID_PARAMS);
    expect(() => parseKdfWorkerParams(undefined)).toThrow(KdfParameterError);
  });
});

describe("deriveKeyBytes in Node (no Worker available)", () => {
  it("falls back to the main thread and matches the core", async () => {
    const direct = await deriveKeyBytesOnThisThread(PBKDF2, text("pw"), filled(16, 9));
    expect(hex(await deriveKeyBytes(PBKDF2, text("pw"), filled(16, 9)))).toBe(hex(direct));
  });

  it("rejects a short salt with KdfParameterError", async () => {
    await expect(deriveKeyBytes(PBKDF2, text("pw"), filled(15, 1))).rejects.toThrow(KdfParameterError);
  });
});

describe("createKdfClient with a worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives through the worker, matches the core (Argon2id and PBKDF2) and leaves the caller's bytes intact", async () => {
    vi.useRealTimers();
    const workers: FakeWorker[] = [];
    const client = createKdfClient({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      // The inline path must NOT be used when the worker works.
      runInline: () => Promise.reject(new Error("inline must not run")),
    });
    for (const params of [PBKDF2, DEFAULT_ARGON2ID_PARAMS]) {
      const secret = text("correct horse battery");
      const salt = filled(16, 5);
      const viaWorker = await client.deriveKeyBytes(params, secret, salt);
      const direct = await deriveKeyBytesOnThisThread(params, text("correct horse battery"), filled(16, 5));
      expect(hex(viaWorker)).toBe(hex(direct));
      expect(hex(secret)).toBe(hex(text("correct horse battery")));
      expect(hex(salt)).toBe(hex(filled(16, 5)));
    }
    expect(workers).toHaveLength(1); // one lazily created worker, reused
    // The buffers that crossed to the worker were copies and have been zeroed by the worker core.
    for (const request of workers[0].requests) {
      expect(new Uint8Array(request.secret).every((b) => b === 0)).toBe(true);
    }
    client.dispose();
  });

  it("does not create a worker until the first request", async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const client = createKdfClient({ createWorker });
    expect(createWorker).not.toHaveBeenCalled();
    expect(client.status().workerAlive).toBe(false);
  });

  it("matches concurrent requests by id even when answers arrive out of order", async () => {
    const worker = new FakeWorker({ answer: false });
    const client = createKdfClient({ createWorker: () => worker });
    const a = client.deriveKeyBytes(PBKDF2, text("first"), filled(16, 1));
    const b = client.deriveKeyBytes(PBKDF2, text("second"), filled(16, 2));
    expect(worker.requests.map((r) => r.id)).toEqual([1, 2]);
    // Answer the second request first, with recognisable keys.
    worker.emit({ v: 1, type: "result", id: 2, key: filled(32, 0xbb).buffer as ArrayBuffer });
    worker.emit({ v: 1, type: "result", id: 1, key: filled(32, 0xaa).buffer as ArrayBuffer });
    expect(hex(await a)).toBe("aa".repeat(32));
    expect(hex(await b)).toBe("bb".repeat(32));
    // An unknown or repeated id is ignored.
    worker.emit({ v: 1, type: "result", id: 99, key: new ArrayBuffer(32) });
    worker.emit({ v: 1, type: "result", id: 1, key: new ArrayBuffer(32) });
    client.dispose();
  });

  it("maps a parameters reply to KdfParameterError and a failure to KdfDerivationError", async () => {
    const worker = new FakeWorker({ answer: false });
    const client = createKdfClient({ createWorker: () => worker });
    const a = client.deriveKeyBytes(PBKDF2, text("x"), filled(16, 1));
    const b = client.deriveKeyBytes(PBKDF2, text("x"), filled(16, 1));
    worker.emit({ v: 1, type: "error", id: 1, kind: "parameters", detail: "iterations=0 is outside" });
    worker.emit({ v: 1, type: "error", id: 2, kind: "failed" });
    await expect(a).rejects.toThrow(KdfParameterError);
    const failure = await b.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(KdfDerivationError);
    expect((failure as KdfDerivationError).reason).toBe("failed");
    client.dispose();
  });

  it("times out a silent worker, rejects with a plain message, terminates it and uses a fresh one next time", async () => {
    const workers: FakeWorker[] = [];
    const client = createKdfClient({
      createWorker: () => {
        const w = new FakeWorker({ answer: workers.length > 0 });
        workers.push(w);
        return w;
      },
      requestTimeoutMs: 5_000,
    });
    const stuck = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    const assertion = expect(stuck).rejects.toMatchObject({ name: "KdfDerivationError", reason: "timeout" });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    expect(workers[0].terminated).toBe(true);
    expect(client.status()).toMatchObject({ workerAlive: false, workerUnusable: false, pending: 0 });

    const ok = await client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    expect(ok.byteLength).toBe(32);
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("the timeout message never contains the secret", async () => {
    const message = new KdfDerivationError("timeout").message + new KdfDerivationError("failed").message;
    expect(message).not.toMatch(/passphrase=|secret/i);
  });

  it("abandons a worker that never starts and finishes the request on the main thread", async () => {
    const worker = new FakeWorker({ announceReady: false, answer: false });
    const runInline = vi.fn(deriveKeyBytesOnThisThread);
    const client = createKdfClient({ createWorker: () => worker, runInline, startupTimeoutMs: 1_000 });
    const result = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    await vi.advanceTimersByTimeAsync(1_001);
    const bytes = await result;
    expect(hex(bytes)).toBe(hex(await deriveKeyBytesOnThisThread(PBKDF2, text("pw"), filled(16, 1))));
    expect(runInline).toHaveBeenCalledTimes(1); // the fallback
    expect(worker.terminated).toBe(true);
    expect(client.status().workerUnusable).toBe(true);

    // From now on the client does not try a worker again: every call runs inline.
    const before = runInline.mock.calls.length;
    await client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    expect(runInline.mock.calls.length).toBe(before + 1);
  });

  it("falls back to the main thread when the worker reports an error event", async () => {
    const worker = new FakeWorker({ answer: false });
    const client = createKdfClient({ createWorker: () => worker });
    const result = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    worker.onerror?.(new Event("error"));
    expect(hex(await result)).toBe(hex(await deriveKeyBytesOnThisThread(PBKDF2, text("pw"), filled(16, 1))));
    expect(worker.terminated).toBe(true);
  });

  it("falls back when posting to the worker throws", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("DataCloneError");
    };
    const client = createKdfClient({ createWorker: () => worker });
    const bytes = await client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    expect(bytes.byteLength).toBe(32);
    expect(client.status().workerUnusable).toBe(true);
  });

  it("uses the main thread when no worker can be created", async () => {
    const runInline = vi.fn(deriveKeyBytesOnThisThread);
    const client = createKdfClient({ createWorker: () => null, runInline });
    const bytes = await client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    expect(bytes.byteLength).toBe(32);
    expect(runInline).toHaveBeenCalledTimes(1);
    expect(client.status().workerUnusable).toBe(true);
  });

  it("terminates the worker when idle and starts a new one for the next request", async () => {
    const workers: FakeWorker[] = [];
    const client = createKdfClient({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      idleTimeoutMs: 2_000,
    });
    const first = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    await vi.advanceTimersByTimeAsync(50);
    await first;
    expect(client.status().workerAlive).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(workers[0].terminated).toBe(true);
    expect(client.status().workerAlive).toBe(false);

    const second = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    await vi.advanceTimersByTimeAsync(50);
    expect((await second).byteLength).toBe(32);
    expect(workers).toHaveLength(2);
    client.dispose();
  });

  it("does not stop the worker while a request is still waiting", async () => {
    const worker = new FakeWorker({ answer: false });
    const client = createKdfClient({ createWorker: () => worker, idleTimeoutMs: 100, requestTimeoutMs: 60_000 });
    const result = client.deriveKeyBytes(PBKDF2, text("pw"), filled(16, 1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(worker.terminated).toBe(false);
    worker.emit({ v: 1, type: "result", id: 1, key: filled(32, 1).buffer as ArrayBuffer });
    expect((await result).byteLength).toBe(32);
    client.dispose();
  });
});
