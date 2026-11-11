// lib/services/vault-kdf-upgrade.ts
// Server side of the automatic PBKDF2 -> Argon2id upgrade. The browser re-wrapped the Vault Master
// Key under a new key-encryption key and verified it (lib/crypto/kdf-upgrade.ts); this stores the
// new wrap, and ONLY if the vault still holds the exact wrap the browser started from.
//
// The swap is one conditional UPDATE: a row is changed only when it belongs to this user and its
// algorithm, wrapped-key ciphertext and key version still match what the browser saw. Postgres
// re-checks that condition on the committed row, so when two tabs or devices race, exactly one
// update matches and the other changes nothing and gets a conflict. The audit event is written in
// the same transaction, so there is never a change without a record or a record without a change.
//
// Never touched: item ciphertexts, wrapped item keys, and the recovery artifact (the recovery
// code wraps the Vault Master Key itself, which has not changed).
import type { PrismaClient } from "@prisma/client";
import { UpgradeVaultKdfSchema } from "../api/dashboard-actions";
import { ValidationError } from "../auth/security";

/** Another device or tab already changed the vault (or there is no such vault for this user). */
export class VaultKdfUpgradeConflictError extends Error {
  public readonly code = "VAULT_KDF_UPGRADE_CONFLICT";
  constructor() {
    super(
      "Your vault was changed somewhere else, so this upgrade was skipped. It will be tried again the next time you unlock."
    );
    this.name = "VaultKdfUpgradeConflictError";
  }
}

export async function upgradeVaultKdf(
  db: Pick<PrismaClient, "$transaction">,
  userId: string,
  rawInput: unknown
): Promise<{ vaultId: string; kdfAlgorithm: string }> {
  // The route already parsed this; parsing again keeps the service safe to call on its own.
  const parsed = UpgradeVaultKdfSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid vault upgrade.");
  }
  const { expected, next } = parsed.data;

  return db.$transaction(async (tx) => {
    const changed = await tx.vault.updateMany({
      where: {
        userId,
        kdfAlgorithm: expected.kdfAlgorithm,
        wrappedMasterKeyCiphertext: expected.wrappedMasterKeyCiphertext,
        currentKeyVersion: expected.keyVersion,
      },
      data: {
        kdfAlgorithm: next.kdfAlgorithm,
        kdfSaltBase64: next.kdfSaltBase64,
        wrappedMasterKeyCiphertext: next.wrappedMasterKeyCiphertext,
        wrappedMasterKeyIv: next.wrappedMasterKeyIv,
      },
    });
    if (changed.count !== 1) throw new VaultKdfUpgradeConflictError();

    const vault = await tx.vault.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    await tx.auditEvent.create({
      data: {
        userId,
        eventType: "VAULT_KDF_UPGRADED",
        severity: "INFO",
        actorType: "USER",
        actorId: userId,
        // Algorithm names only: no salt, wrap or key material in the log.
        redactedMeta: JSON.stringify({
          vaultId: vault.id,
          fromKdfAlgorithm: expected.kdfAlgorithm,
          toKdfAlgorithm: next.kdfAlgorithm,
        }),
      },
    });
    return { vaultId: vault.id, kdfAlgorithm: next.kdfAlgorithm };
  });
}
