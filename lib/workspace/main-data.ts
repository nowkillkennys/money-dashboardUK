import { withUserDb } from "./db";
import { readDebtAccounts } from "./ledger";
const mapping = {
  accounts: "money_accounts",
  transactions: "money_transactions",
  goals: "money_goals",
  goalAccounts: "money_goal_accounts",
  plans: "money_allocation_plans",
  holdings: "money_holdings",
  subscriptions: "money_subscriptions",
  dividends: "money_dividends",
  creditCards: "money_credit_cards",
  creditCardCharges: "money_credit_card_charges",
  creditCardPayments: "money_credit_card_payments",
  netWorthSnapshots: "money_net_worth_snapshots",
};
const numeric = new Set([
  "starting_balance",
  "amount",
  "received_amount",
  "refunded_amount",
  "personal_share_percent",
  "target_amount",
  "allocated_amount",
  "shares",
  "cost_basis",
  "credit_limit",
  "cash_base",
  "holdings_base",
  "dividends_base",
  "total_base",
  "rent_amount",
  "monthly_essentials_budget",
  "paycheck_amount",
]);
function adapt(row: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? ["date", "target_date", "next_billing", "as_of"].includes(key)
          ? value.toISOString().slice(0, 10)
          : value.toISOString()
        : numeric.has(key) && value !== null
          ? Number(value)
          : value,
    ])
  );
}
export function mainData(owner: string, username: string) {
  return withUserDb(
    owner,
    async (c) => {
      const data: Record<string, any> = {};
      for (const [key, table] of Object.entries(mapping)) {
        data[key] = (
          await c.query(
            `SELECT * FROM ${table} ORDER BY ${key === "accounts" || key === "creditCards" ? "archived,position NULLS LAST," : ""}created_at,id`
          )
        ).rows.map(adapt);
      }
      const setting = (await c.query("SELECT * FROM money_settings")).rows[0];
      data.settings = setting
        ? adapt(setting)
        : {
            id: "",
            user_id: owner,
            base_currency: "GBP",
            display_name: username,
            greeting_tone: "neutral",
            expense_categories: ["Food", "Transport", "Bills", "Rent", "Fun", "Health", "Other"],
            subscription_categories: ["Streaming", "Software", "Other"],
            rent_amount: 0,
            rent_day: 1,
            rent_reminder_days: 0,
            bill_reminder_days: 0,
            monthly_essentials_budget: 0,
            paycheck_amount: 0,
            paycheck_frequency: "monthly",
            auto_apply_allocation: false,
            dismissed_merchants: [],
          };
      if (setting) {
        delete data.settings.pin_hash;
        delete data.settings.failed_attempts;
        delete data.settings.locked_until;
      }
      const debts = await readDebtAccounts(c);
      data.creditCards = data.creditCards.map((card: any) => {
        const debt = debts.find((d) => d.id === card.id);
        if (!debt) throw Error("Card statement identity is missing");
        return {
          ...card,
          tracked_balance: debt.trackedBalance,
          reconciliation_needed: debt.reconciliationNeeded,
          version: debt.version,
        };
      });
      data.balances = {};
      for (const bank of data.accounts) {
        let pence = Math.round(bank.starting_balance * 100);
        for (const tx of data.transactions) {
          const value = Math.round(tx.amount * 100);
          if ((tx.type === "income" || tx.type === "correction") && tx.account_id === bank.id)
            pence += value;
          if (tx.type === "expense" && tx.account_id === bank.id) pence -= value;
          if (tx.type === "transfer") {
            if (tx.from_account_id === bank.id) pence -= value;
            if (tx.to_account_id === bank.id)
              pence += Math.round((tx.received_amount ?? tx.amount) * 100);
          }
        }
        for (const payment of data.creditCardPayments)
          if (payment.account_id === bank.id) pence -= Math.round(payment.amount * 100);
        data.balances[bank.id] = pence / 100;
      }
      data.otherDebtTotal = debts
        .filter(
          (d) => d.kind !== "credit_card" || !data.creditCards.some((card: any) => card.id === d.id)
        )
        .reduce((sum, d) => sum + (d.trackedBalance === null ? 0 : Number(d.trackedBalance)), 0);
      data.unresolvedDebtCount = debts.filter((d) => d.reconciliationNeeded).length;
      return data;
    },
    true
  );
}
