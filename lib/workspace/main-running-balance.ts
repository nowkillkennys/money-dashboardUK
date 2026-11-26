import { HttpError } from "./http";
export function mainRunningBalance(data: Record<string, any>, accountId: string) {
  const bank = data.accounts.find((a: any) => a.id === accountId);
  if (!bank) throw new HttpError(404, "Account not found");
  let pence = Math.round(bank.starting_balance * 100);
  const rows: any[] = [];
  for (const tx of data.transactions) {
    let delta = 0;
    if (tx.account_id === accountId) {
      if (tx.type === "income" || tx.type === "correction") delta = Math.round(tx.amount * 100);
      if (tx.type === "expense") delta = -Math.round(tx.amount * 100);
    }
    if (tx.type === "transfer") {
      if (tx.from_account_id === accountId) delta = -Math.round(tx.amount * 100);
      if (tx.to_account_id === accountId)
        delta = Math.round((tx.received_amount ?? tx.amount) * 100);
    }
    if (
      delta ||
      tx.account_id === accountId ||
      tx.from_account_id === accountId ||
      tx.to_account_id === accountId
    )
      rows.push({ ...tx, signed_amount: delta / 100 });
  }
  for (const payment of data.creditCardPayments)
    if (payment.account_id === accountId)
      rows.push({
        ...payment,
        type: "transfer",
        currency: bank.currency,
        account_id: null,
        from_account_id: bank.id,
        to_account_id: null,
        category: "Credit card repayment",
        merchant: null,
        notes: payment.notes || "Credit card repayment",
        signed_amount: -payment.amount,
        source: "card_payment",
      });
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.created_at).localeCompare(String(b.created_at)) ||
      a.id.localeCompare(b.id)
  );
  return rows
    .map((row) => {
      pence += Math.round(row.signed_amount * 100);
      return { ...row, running_balance: pence / 100 };
    })
    .reverse();
}
