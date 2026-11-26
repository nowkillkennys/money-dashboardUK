import { formatMoneyDecimal, parseMoneyMinor } from "./money";
export type DebtPayment = {
  id: string;
  amount: string;
  status: "posted" | "legacy" | "pending" | "voided";
};
export type PaymentDisposition = {
  paymentId: string;
  disposition: "included" | "excluded" | "unresolved";
};
export type DebtBalance = {
  reportedBalance: string;
  trackedBalance: string | null;
  reconciliationNeeded: boolean;
  pendingTotal: string;
};
/** Pure decision only. Caller must supply one owner/account's complete locked payment set. Dates never imply inclusion. */
export function deriveDebtBalance(
  amount: string,
  payments: readonly DebtPayment[],
  dispositions: readonly PaymentDisposition[]
): DebtBalance {
  const reported = parseMoneyMinor(amount);
  const ids = new Set<string>();
  for (const payment of payments) {
    if (!payment.id || ids.has(payment.id)) throw new Error("Duplicate payment");
    ids.add(payment.id);
    parseMoneyMinor(payment.amount);
    if (!["posted", "legacy", "pending", "voided"].includes(payment.status))
      throw new Error("Invalid payment status");
  }
  const active = payments.filter((p) => p.status === "posted" || p.status === "legacy");
  const decisions = new Map<string, PaymentDisposition["disposition"]>();
  for (const decision of dispositions) {
    if (
      decisions.has(decision.paymentId) ||
      !active.some((p) => p.id === decision.paymentId) ||
      !["included", "excluded", "unresolved"].includes(decision.disposition)
    )
      throw new Error("Invalid payment classification");
    decisions.set(decision.paymentId, decision.disposition);
  }
  if (decisions.size !== active.length) throw new Error("Classify every active payment");
  const unresolved = [...decisions.values()].includes("unresolved");
  const excluded = active.reduce(
    (sum, p) => sum + (decisions.get(p.id) === "excluded" ? parseMoneyMinor(p.amount) : 0),
    0
  );
  if (excluded > reported) throw new Error("Payment exceeds the tracked balance");
  const pending = payments
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + parseMoneyMinor(p.amount), 0);
  return {
    reportedBalance: formatMoneyDecimal(reported),
    trackedBalance: unresolved ? null : formatMoneyDecimal(reported - excluded),
    reconciliationNeeded: unresolved,
    pendingTotal: formatMoneyDecimal(pending),
  };
}
