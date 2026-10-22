export type DashboardView =
  | "overview"
  | "vault"
  | "people"
  | "audit"
  | "schedule"
  | "recovery"
  | "settings";

export interface UserAccount {
  id: string;
  email: string;
  fullName?: string | null;
  role?: string;
}

export interface VaultItemData {
  id: string;
  category: string;
  schemaVersion: number;
  keyVersion: number;
  ciphertextBase64: string;
  ivBase64: string;
  wrappedItemKeyBase64: string;
  wrappedItemKeyIvBase64: string;
  aadResourceId: string;
  createdAt: string;
}

export interface ContactData {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  isBeneficiary: boolean;
  isTrustedVerifier: boolean;
  publicKeyBase64?: string | null;
  createdAt?: string;
}

export interface AssignmentData {
  id: string;
  itemId: string;
  contactId: string;
  keyVersion: number;
  createdAt?: string;
}

export interface ScheduleData {
  id?: string;
  state: "HEALTHY" | "PENDING_ESCALATION" | "VERIFICATION_REQUIRED" | "RELEASE_HOLD" | "SCOPED_RELEASE" | "PAUSED" | string;
  intervalDays: number;
  gracePeriodDays: number;
  lastCheckInAt?: string | null;
  nextDueAt?: string | null;
  pausedUntil?: string | null;
}

export interface AuditEventData {
  id: string;
  eventType: string;
  redactedMeta: string;
  createdAt: string;
}

export interface RecoveryArtifactData {
  id: string;
  keyVersion: number;
  fingerprintHex: string;
  createdAt: string;
  recoveryWrappedVmKBase64: string;
  recoveryWrappedVmKIv: string;
  kdfSaltBase64: string;
  kdfAlgorithm: string;
}
