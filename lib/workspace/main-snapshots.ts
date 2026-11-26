import { withUserDb } from "./db";
import { readDebtAccounts } from "./ledger";
import { londonCivilDate } from "../money/uk-locale";

// Keep derived daily history separate from the financial command journal.
export function captureMainSnapshot(owner: string) {
  return withUserDb(owner, async (client) => {
    await client.query(
      "INSERT INTO workspace_features(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
      [owner]
    );
    // Financial commands take this same owner feature-row lock.
    const flags = (await client.query("SELECT manual FROM workspace_features FOR UPDATE")).rows[0];
    const skip = (reason: string) => ({ ok: false as const, skipped: true as const, reason });
    if (!flags.manual) return skip("manual_disabled");
    const unsupported = (
      await client.query(`SELECT EXISTS (
      SELECT 1 FROM money_accounts WHERE currency <> 'GBP'
      UNION ALL SELECT 1 FROM money_transactions WHERE currency <> 'GBP'
      UNION ALL SELECT 1 FROM money_credit_cards WHERE currency <> 'GBP'
      UNION ALL SELECT 1 FROM money_settings WHERE base_currency <> 'GBP'
      UNION ALL SELECT 1 FROM money_holdings WHERE cost_currency <> 'GBP'
      UNION ALL SELECT 1 FROM money_dividends WHERE currency <> 'GBP'
    ) AS unsupported`)
    ).rows[0].unsupported;
    if (unsupported) return skip("unsupported_currency");
    const debts = await readDebtAccounts(client);
    if (
      debts.some(
        (debt) => debt.trackedBalance === null || debt.reconciliationNeeded || debt.review_required
      )
    )
      return skip("incomplete_debt");
    if (
      (await client.query("SELECT EXISTS(SELECT 1 FROM money_holdings WHERE shares > 0) AS live"))
        .rows[0].live
    )
      return skip("missing_market_values");
    // Numeric SQL preserves pennies across every bank, including investing cash.
    const cash = (
      await client.query(`SELECT (
      COALESCE((SELECT SUM(starting_balance) FROM money_accounts),0)
      + COALESCE((SELECT SUM(CASE WHEN type IN ('income','correction') THEN amount WHEN type='expense' THEN -amount ELSE 0 END)
          FROM money_transactions WHERE account_id IN (SELECT id FROM money_accounts)),0)
      - COALESCE((SELECT SUM(amount) FROM money_transactions WHERE type='transfer' AND from_account_id IN (SELECT id FROM money_accounts)),0)
      + COALESCE((SELECT SUM(COALESCE(received_amount,amount)) FROM money_transactions WHERE type='transfer' AND to_account_id IN (SELECT id FROM money_accounts)),0)
      - COALESCE((SELECT SUM(amount) FROM money_credit_card_payments WHERE account_id IN (SELECT id FROM money_accounts)),0)
    )::text AS cash`)
    ).rows[0].cash;
    // Debt strings are already exact decimal pounds; let PostgreSQL sum them.
    const debtAmounts = debts.map((debt) => debt.trackedBalance!);
    const day = londonCivilDate();
    const snapshot = (
      await client.query(
        `INSERT INTO money_net_worth_snapshots
      (user_id,date,cash_base,holdings_base,dividends_base,total_base,base_currency)
      VALUES($1,$2,$3::numeric,0,0,$3::numeric-COALESCE((SELECT SUM(value::numeric) FROM unnest($4::text[]) AS value),0),'GBP')
      ON CONFLICT(user_id,date) DO UPDATE SET cash_base=EXCLUDED.cash_base,
        holdings_base=0,dividends_base=0,total_base=EXCLUDED.total_base,base_currency='GBP',
        version=CASE WHEN (money_net_worth_snapshots.cash_base,money_net_worth_snapshots.holdings_base,
          money_net_worth_snapshots.dividends_base,money_net_worth_snapshots.total_base,money_net_worth_snapshots.base_currency)
          IS DISTINCT FROM (EXCLUDED.cash_base,EXCLUDED.holdings_base,EXCLUDED.dividends_base,EXCLUDED.total_base,EXCLUDED.base_currency)
          THEN money_net_worth_snapshots.version+1 ELSE money_net_worth_snapshots.version END RETURNING *`,
        [owner, day, cash, debtAmounts]
      )
    ).rows[0];
    return { ok: true as const, snapshot };
  });
}
