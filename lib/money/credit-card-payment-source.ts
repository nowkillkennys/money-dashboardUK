import type { CreditCardPayment } from "./database.types";

export type CreditCardPaymentSource = "account" | "cashback" | "credit" | "correction" | "other";

export function getCreditCardPaymentSource(
  payment: Pick<CreditCardPayment, "account_id" | "notes"> &
    Partial<Pick<CreditCardPayment, "refund_of_transaction_id">>
): CreditCardPaymentSource {
  if (payment.account_id) return "account";
  if (payment.refund_of_transaction_id) return "credit";

  const notes = payment.notes?.trim().toLowerCase() ?? "";
  if (notes.includes("balance correction")) return "correction";
  if (notes.includes("cashback")) return "cashback";
  if (notes.includes("credit") || notes.includes("refund")) return "credit";
  return "other";
}
