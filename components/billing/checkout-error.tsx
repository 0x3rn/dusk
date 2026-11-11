import { Notice } from "@/components/ui/notice";
import { buttonSecondaryClass } from "@/components/ui/form-field";
import { CHECKOUT_SUPPORT_PLACEHOLDER } from "@/lib/billing/checkout-client";

/**
 * Shown under a buy button when checkout could not start. It is an alert, so screen readers
 * announce it, and it always offers a retry and a way to reach a person.
 */
export function CheckoutError({
  message,
  onRetry,
  pending,
}: {
  message: string;
  onRetry: () => void;
  pending: boolean;
}) {
  return (
    <Notice tone="error" className="text-left">
      <p>{message}</p>
      <p className="mt-1 text-[13px] font-normal">
        Still stuck? Contact us at {CHECKOUT_SUPPORT_PLACEHOLDER}.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className={`${buttonSecondaryClass} mt-3 w-full sm:w-auto`}
      >
        {pending ? "Trying again..." : "Try again"}
      </button>
    </Notice>
  );
}
