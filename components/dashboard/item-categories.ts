// One list of vault item categories, shared by the vault, the overview and the beneficiary page,
// so a stored value like CRYPTO_RECOVERY is never shown to a person as raw text.

export const ITEM_CATEGORIES = [
  { value: "CREDENTIAL", label: "Account login" },
  { value: "CRYPTO_RECOVERY", label: "Crypto wallet or recovery phrase" },
  { value: "FINANCIAL_INSTRUCTION", label: "Financial instructions" },
  { value: "DEVICE_ACCESS", label: "Device or PIN" },
  { value: "DOCUMENT", label: "Private document or note" },
  { value: "FINAL_WISH", label: "Final wishes or message" },
  { value: "SECURE_NOTE", label: "Other note" },
] as const;

export function categoryLabel(value: string): string {
  return ITEM_CATEGORIES.find((c) => c.value === value)?.label ?? "Other note";
}
