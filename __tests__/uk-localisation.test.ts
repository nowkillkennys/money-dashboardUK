import { describe, expect, it } from "vitest";
import { getDemoMoneyData } from "../app/hooks/demo-data";
import { computeAccountBalance, computeCreditCardBalance } from "@/lib/money/queries";
import { computeNetWorthBase } from "@/lib/money/net-worth";
import { convertCurrency } from "@/lib/money/fx";
import { DEMO_FX, formatUkDate, londonCivilDate, offsetCivilDate } from "@/lib/money/uk-locale";

describe("UK synthetic demo", () => {
  it("uses GBP bank accounts and card debts with clearly synthetic identity", () => {
    const data = getDemoMoneyData();
    expect(data.settings.base_currency).toBe("GBP");
    expect(data.settings.display_name).toContain("Synthetic");
    expect(data.accounts.filter(a => a.type === "checking").every(a => a.currency === "GBP")).toBe(true);
    expect(data.creditCards.every(c => c.currency === "GBP")).toBe(true);
    expect(data.transactions.filter(t => t.type === "income" && t.category === "Salary").every(t => t.recurrence === "monthly")).toBe(true);
  });
  it("records foreign transfers in source currency and an explicit destination amount", () => {
    const data = getDemoMoneyData();
    const transfer = data.transactions.find(t => t.id === "demo-tx-10")!;
    expect(transfer.currency).toBe("GBP");
    expect(transfer.received_amount).toBe(convertCurrency(transfer.amount, "GBP", "USD", DEMO_FX));
    expect(transfer.type).toBe("transfer");
  });
  it("moves money between accounts without creating income or spending", () => {
    const data = getDemoMoneyData();
    const transfer = data.transactions.find(t => t.id === "demo-tx-6")!;
    const source = computeAccountBalance(transfer.from_account_id!, [transfer], 1000);
    const destination = computeAccountBalance(transfer.to_account_id!, [transfer], 1000);
    expect(source + destination).toBe(2000);
    expect(computeNetWorthBase({ cashBase: 2000, holdingsBase: 0, dividendsBase: 0, creditCardDebtBase: 350 })).toBe(1650);
  });
  it("deducts card repayments from cash and debt once, without a second expense", () => {
    const data = getDemoMoneyData();
    const bank = data.accounts.find(a => a.id === "demo-acct-checking")!;
    const beforeCash = computeAccountBalance(bank.id, data.transactions, bank.starting_balance);
    const afterCash = computeAccountBalance(bank.id, data.transactions, bank.starting_balance, data.creditCardPayments);
    const totalPaid = data.creditCardPayments.reduce((sum, payment) => sum + payment.amount, 0);
    expect(beforeCash - afterCash).toBeCloseTo(totalPaid, 2);
    expect(afterCash).toBeCloseTo(8222.52, 2);
    const debtBefore = data.creditCards.reduce((sum, card) => sum + computeCreditCardBalance(card.id, data.creditCardCharges, []), 0);
    const debtAfter = data.creditCards.reduce((sum, card) => sum + computeCreditCardBalance(card.id, data.creditCardCharges, data.creditCardPayments), 0);
    expect(debtBefore - debtAfter).toBeCloseTo(totalPaid, 2);
    expect(debtAfter).toBeCloseTo(351.99, 2);
    expect(afterCash - debtAfter).toBeCloseTo(beforeCash - debtBefore, 2);
    expect(data.transactions.some(t => data.creditCardPayments.some(p => p.id === t.id))).toBe(false);
    const investment = data.accounts.find(a => a.id === "demo-acct-investing")!;
    expect(computeAccountBalance(investment.id, data.transactions, investment.starting_balance)).toBe(3375);
    expect(data.holdings.reduce((sum, h) => sum + h.shares, 0)).toBe(3375);
  });
  it("formats UK dates and preserves civil days across London summer time", () => {
    expect(londonCivilDate(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(offsetCivilDate("2026-03-28", 2)).toBe("2026-03-30");
    expect(formatUkDate("2026-07-01")).toBe("01/07/2026");
    expect(formatUkDate("2026-02-30")).toBe("Invalid date");
  });
  it("uses reciprocal synthetic GBP/USD and GBP/EUR rates", () => {
    expect(convertCurrency(80, "GBP", "USD", DEMO_FX)).toBe(100);
    expect(convertCurrency(100, "USD", "GBP", DEMO_FX)).toBe(80);
    expect(convertCurrency(80, "GBP", "EUR", DEMO_FX)).toBe(92);
  });
});
