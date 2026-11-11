// lib/crypto/kdf.test.ts
import * as nodeCrypto from "node:crypto";
import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARGON2ID_DEFAULT_ALGORITHM_ID,
  DEFAULT_ARGON2ID_PARAMS,
  KDF_LIMITS,
  KdfParameterError,
  LEGACY_RECOVERY_PBKDF2_ALGORITHM_ID,
  LEGACY_VAULT_PBKDF2_ALGORITHM_ID,
  argon2idDerive,
  assertKdfParamsAcceptable,
  deriveKeyBytes,
  formatKdfAlgorithm,
  parseKdfAlgorithm,
} from "./kdf";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);
const text = (value: string) => new TextEncoder().encode(value);

// Node 24.7+ ships OpenSSL's Argon2. It is an independent implementation, used here as a second
// opinion on the WebAssembly library; older Node versions skip those comparisons. The installed
// @types/node predates the API, so its shape is declared here.
type NodeArgon2Sync = (
  algorithm: "argon2id",
  parameters: {
    message: Uint8Array;
    nonce: Uint8Array;
    secret?: Uint8Array;
    associatedData?: Uint8Array;
    parallelism: number;
    tagLength: number;
    memory: number;
    passes: number;
  }
) => Buffer;
const maybeArgon2Sync = (nodeCrypto as unknown as { argon2Sync?: NodeArgon2Sync }).argon2Sync;
const nodeHasArgon2 = typeof maybeArgon2Sync === "function";
const argon2Sync: NodeArgon2Sync = (algorithm, parameters) => {
  if (!maybeArgon2Sync) throw new Error("This Node version has no crypto.argon2Sync.");
  return maybeArgon2Sync(algorithm, parameters);
};

describe("Argon2id (hash-wasm wrapper) test vectors", () => {
  it("matches the Argon2 reference implementation's published argon2id vector", async () => {
    // From the reference implementation's test suite: argon2id v=19, m=65536, t=2, p=1,
    // password "password", salt "somesalt" -> $argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXP...
    const tag = await argon2idDerive({
      password: text("password"),
      salt: text("somesalt"),
      memoryKiB: 65_536,
      timeCost: 2,
      parallelism: 1,
    });
    expect(hex(tag)).toBe("09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7");
    expect(Buffer.from(tag).toString("base64").replace(/=+$/, "")).toBe("CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc");
  });

  describe.skipIf(!nodeHasArgon2)("RFC 9106 section 5.3 (Argon2id) and cross-checks against OpenSSL", () => {
    // RFC 9106 5.3: password 32x01, salt 16x02, secret 8x03, associated data 12x04,
    // t=3, m=32 KiB, p=4, tag length 32.
    const RFC_9106_TAG = "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659";

    it("the OpenSSL oracle reproduces the RFC 9106 tag exactly", () => {
      const tag = argon2Sync("argon2id", {
        message: filled(32, 1),
        nonce: filled(16, 2),
        secret: filled(8, 3),
        associatedData: filled(12, 4),
        parallelism: 4,
        tagLength: 32,
        memory: 32,
        passes: 3,
      });
      expect(tag.toString("hex")).toBe(RFC_9106_TAG);
    });

    it("hash-wasm equals OpenSSL on the RFC 9106 parameters (lanes, secret, no associated data)", async () => {
      // hash-wasm has no associated-data input, so the RFC tag itself cannot be reproduced; every
      // other part of the RFC 9106 setup (4 lanes, 3 passes, 32 KiB, secret) is compared instead.
      const wasm = await argon2idDerive({
        password: filled(32, 1),
        salt: filled(16, 2),
        secret: filled(8, 3),
        memoryKiB: 32,
        timeCost: 3,
        parallelism: 4,
      });
      const native = argon2Sync("argon2id", {
        message: filled(32, 1),
        nonce: filled(16, 2),
        secret: filled(8, 3),
        parallelism: 4,
        tagLength: 32,
        memory: 32,
        passes: 3,
      });
      expect(hex(wasm)).toBe(native.toString("hex"));
      expect(hex(wasm)).not.toBe(RFC_9106_TAG);
    });

    it("hash-wasm equals OpenSSL on Dusk's own parameters (19456 KiB, 2 passes, 1 lane)", async () => {
      const password = text("correct horse battery staple".normalize("NFKC"));
      const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
      const wasm = await argon2idDerive({ password, salt, memoryKiB: 19_456, timeCost: 2, parallelism: 1 });
      const native = argon2Sync("argon2id", {
        message: password,
        nonce: salt,
        parallelism: 1,
        tagLength: 32,
        memory: 19_456,
        passes: 2,
      });
      expect(hex(wasm)).toBe(native.toString("hex"));
      expect(wasm.byteLength).toBe(32);
    });
  });

  it("is deterministic and depends on every input", async () => {
    const base = { password: text("passphrase-1"), salt: filled(16, 9), memoryKiB: 19_456, timeCost: 2, parallelism: 1 };
    const a = hex(await argon2idDerive(base));
    expect(hex(await argon2idDerive(base))).toBe(a);
    expect(hex(await argon2idDerive({ ...base, password: text("passphrase-2") }))).not.toBe(a);
    expect(hex(await argon2idDerive({ ...base, salt: filled(16, 10) }))).not.toBe(a);
    expect(hex(await argon2idDerive({ ...base, memoryKiB: 19_457 }))).not.toBe(a);
    expect(hex(await argon2idDerive({ ...base, timeCost: 3 }))).not.toBe(a);
    expect(hex(await argon2idDerive({ ...base, parallelism: 2 }))).not.toBe(a);
  });

  it("refuses absurd values before allocating anything", async () => {
    const ok = { password: text("x"), salt: filled(16, 1), memoryKiB: 19_456, timeCost: 2, parallelism: 1 };
    await expect(argon2idDerive({ ...ok, memoryKiB: 4_194_304 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, memoryKiB: 1 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, timeCost: 1_000_000 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, timeCost: 0 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, parallelism: 0 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, memoryKiB: 19_456.5 })).rejects.toThrow(KdfParameterError);
    await expect(argon2idDerive({ ...ok, salt: filled(7, 1) })).rejects.toThrow(KdfParameterError);
  });
});

describe("deriveKeyBytes", () => {
  it("PBKDF2-SHA256 equals Node's independent implementation", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => 255 - i);
    const bytes = await deriveKeyBytes({ algorithm: "PBKDF2-SHA256", iterations: 5_000 }, text("a passphrase"), salt);
    expect(hex(bytes)).toBe(pbkdf2Sync("a passphrase", Buffer.from(salt), 5_000, 32, "sha256").toString("hex"));
  });

  it("Argon2id dispatch uses the stated parameters", async () => {
    const salt = filled(16, 5);
    const viaDispatch = await deriveKeyBytes(DEFAULT_ARGON2ID_PARAMS, text("pw"), salt);
    const direct = await argon2idDerive({ password: text("pw"), salt, memoryKiB: 19_456, timeCost: 2, parallelism: 1 });
    expect(hex(viaDispatch)).toBe(hex(direct));
  });

  it("rejects a salt shorter than 16 bytes", async () => {
    await expect(deriveKeyBytes(DEFAULT_ARGON2ID_PARAMS, text("pw"), filled(15, 1))).rejects.toThrow(KdfParameterError);
    await expect(
      deriveKeyBytes({ algorithm: "PBKDF2-SHA256", iterations: 600_000 }, text("pw"), filled(8, 1))
    ).rejects.toThrow(KdfParameterError);
  });
});

describe("parseKdfAlgorithm", () => {
  it("accepts the identifiers Dusk has written", () => {
    expect(parseKdfAlgorithm(ARGON2ID_DEFAULT_ALGORITHM_ID, "vault-passphrase").params).toEqual({
      algorithm: "ARGON2ID",
      memoryKiB: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(parseKdfAlgorithm(LEGACY_VAULT_PBKDF2_ALGORITHM_ID, "vault-passphrase").params).toEqual({
      algorithm: "PBKDF2-SHA256",
      iterations: 600_000,
    });
    expect(parseKdfAlgorithm(LEGACY_RECOVERY_PBKDF2_ALGORITHM_ID, "recovery-kit")).toEqual({
      params: { algorithm: "PBKDF2-SHA256", iterations: 310_000 },
      usesKitPassphrase: false,
    });
    expect(parseKdfAlgorithm("PBKDF2-SHA256-310000+PASSPHRASE", "recovery-kit").usesKitPassphrase).toBe(true);
    expect(parseKdfAlgorithm("ARGON2ID-19456-2-1+PASSPHRASE", "recovery-kit")).toEqual({
      params: { algorithm: "ARGON2ID", memoryKiB: 19_456, timeCost: 2, parallelism: 1 },
      usesKitPassphrase: true,
    });
  });

  it("the default identifier constant is exactly what the default parameters format to", () => {
    expect(formatKdfAlgorithm(DEFAULT_ARGON2ID_PARAMS)).toBe(ARGON2ID_DEFAULT_ALGORITHM_ID);
    expect(ARGON2ID_DEFAULT_ALGORITHM_ID).toBe("ARGON2ID-19456-2-1");
  });

  it("round-trips format -> parse for allowed parameters", () => {
    const samples = [
      DEFAULT_ARGON2ID_PARAMS,
      { algorithm: "ARGON2ID", memoryKiB: 65_536, timeCost: 6, parallelism: 4 },
      { algorithm: "PBKDF2-SHA256", iterations: 600_000 },
      { algorithm: "PBKDF2-SHA256", iterations: 1_000_000 },
    ] as const;
    for (const params of samples) {
      expect(parseKdfAlgorithm(formatKdfAlgorithm(params), "vault-passphrase").params).toEqual(params);
    }
    expect(parseKdfAlgorithm(formatKdfAlgorithm(DEFAULT_ARGON2ID_PARAMS, { kitPassphrase: true }), "recovery-kit").usesKitPassphrase).toBe(true);
  });

  it("rejects absurd or out-of-range values (hostile-server denial of service)", () => {
    const bad = [
      "ARGON2ID-4194304-2-1", // 4 GiB
      "ARGON2ID-65537-2-1", // one KiB over the ceiling
      "ARGON2ID-19456-1000-1", // huge time cost
      "ARGON2ID-19456-7-1",
      "ARGON2ID-19456-2-64",
      "ARGON2ID-19456-2-5",
      "ARGON2ID-999999999-2-1",
      "PBKDF2-SHA256-2147483647",
      "PBKDF2-SHA256-1000001",
      "PBKDF2-SHA256-99999999999999999999",
    ];
    for (const id of bad) {
      expect(() => parseKdfAlgorithm(id, "vault-passphrase"), id).toThrow(KdfParameterError);
    }
  });

  it("rejects weaker-than-default values (downgrade)", () => {
    const weak = [
      "ARGON2ID-19455-2-1",
      "ARGON2ID-8192-2-1",
      "ARGON2ID-19456-1-1",
      "PBKDF2-SHA256-599999",
      "PBKDF2-SHA256-1",
      "PBKDF2-SHA256-1000",
    ];
    for (const id of weak) {
      expect(() => parseKdfAlgorithm(id, "vault-passphrase"), id).toThrow(KdfParameterError);
    }
    // The recovery floor is lower only because its secret is a 160-bit random code.
    expect(() => parseKdfAlgorithm("PBKDF2-SHA256-309999", "recovery-kit")).toThrow(KdfParameterError);
  });

  it("rejects unknown algorithms and malformed spellings", () => {
    const malformed = [
      "",
      "PBKDF2",
      "PBKDF2-SHA256",
      "PBKDF2-SHA256-",
      "PBKDF2-SHA1-600000",
      "PBKDF2-SHA512-600000",
      "SCRYPT-32768-8-1",
      "BCRYPT-12",
      "ARGON2I-19456-2-1",
      "ARGON2D-19456-2-1",
      "ARGON2ID-19456-2",
      "ARGON2ID-19456-2-1-1",
      "argon2id-19456-2-1",
      "pbkdf2-sha256-600000",
      "PBKDF2-SHA256-0600000", // leading zero: one number, one spelling
      "PBKDF2-SHA256--600000",
      "PBKDF2-SHA256-600000 ",
      " PBKDF2-SHA256-600000",
      "PBKDF2-SHA256-6e5",
      "PBKDF2-SHA256-600000.0",
      "ARGON2ID-19456-2-1;",
      "PBKDF2-SHA256-600000+PASSPHRASE+PASSPHRASE",
      "none",
      "x".repeat(65),
      "ARGON2ID-19456-2-1\n",
    ];
    for (const id of malformed) {
      expect(() => parseKdfAlgorithm(id, "vault-passphrase"), JSON.stringify(id)).toThrow(KdfParameterError);
    }
    // Not strings at all (the value comes from JSON sent by a server).
    for (const value of [null, undefined, 600_000, {}, []] as unknown[]) {
      expect(() => parseKdfAlgorithm(value as string, "vault-passphrase")).toThrow(KdfParameterError);
    }
  });

  it("only recovery kits may carry the kit-passphrase suffix", () => {
    expect(() => parseKdfAlgorithm("ARGON2ID-19456-2-1+PASSPHRASE", "vault-passphrase")).toThrow(KdfParameterError);
    expect(() => parseKdfAlgorithm("PBKDF2-SHA256-600000+PASSPHRASE", "vault-passphrase")).toThrow(KdfParameterError);
  });

  it("the test-only policy lowers the PBKDF2 floor but never the ceiling or Argon2id", () => {
    expect(() => parseKdfAlgorithm("PBKDF2-SHA256-1000", "vault-passphrase")).toThrow(KdfParameterError);
    expect(parseKdfAlgorithm("PBKDF2-SHA256-1000", "vault-passphrase", { pbkdf2MinIterations: 1_000 }).params).toEqual({
      algorithm: "PBKDF2-SHA256",
      iterations: 1_000,
    });
    expect(() => parseKdfAlgorithm("PBKDF2-SHA256-5000000", "vault-passphrase", { pbkdf2MinIterations: 1_000 })).toThrow(KdfParameterError);
    expect(() => parseKdfAlgorithm("ARGON2ID-8192-2-1", "vault-passphrase", { pbkdf2MinIterations: 1_000 })).toThrow(KdfParameterError);
  });

  it("does not leak the offending value into the person-facing message", () => {
    try {
      parseKdfAlgorithm("ARGON2ID-4194304-2-1", "vault-passphrase");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KdfParameterError);
      const error = err as KdfParameterError;
      expect(error.message).not.toMatch(/\d{5,}/);
      expect(error.message).not.toMatch(/argon|pbkdf|kib|memory/i);
      expect(error.detail).toContain("4194304");
    }
  });
});

describe("assertKdfParamsAcceptable", () => {
  it("accepts the defaults and the edges, rejects just beyond them", () => {
    const l = KDF_LIMITS.argon2id;
    expect(() => assertKdfParamsAcceptable(DEFAULT_ARGON2ID_PARAMS, "vault-passphrase")).not.toThrow();
    expect(() =>
      assertKdfParamsAcceptable({ algorithm: "ARGON2ID", memoryKiB: l.maxMemoryKiB, timeCost: l.maxTimeCost, parallelism: l.maxParallelism }, "vault-passphrase")
    ).not.toThrow();
    expect(() =>
      assertKdfParamsAcceptable({ algorithm: "ARGON2ID", memoryKiB: l.maxMemoryKiB + 1, timeCost: 2, parallelism: 1 }, "vault-passphrase")
    ).toThrow(KdfParameterError);
    expect(() =>
      assertKdfParamsAcceptable({ algorithm: "ARGON2ID", memoryKiB: 19_456, timeCost: 2, parallelism: Number.NaN }, "vault-passphrase")
    ).toThrow(KdfParameterError);
    expect(() =>
      assertKdfParamsAcceptable({ algorithm: "PBKDF2-SHA256", iterations: Number.POSITIVE_INFINITY }, "vault-passphrase")
    ).toThrow(KdfParameterError);
  });
});
