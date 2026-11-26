# Authenticated feature continuation — 26 November 2026

This work extends the original main app at http://127.0.0.1:13022/, not the separate synthetic demo. `/workspace` is only a redirect to `/debts`. All new commands run through the existing owner-scoped command journal, manual feature gate, transactional receipts and RLS. There are no new schema migrations, providers or automatic record imports. Existing login, databases and financial records are retained.

## Delivered behavior

- Goals: create/edit/complete/delete, owner-owned account links and exact earmarks; allocation plan create/edit/delete/activate. Links and plans are validated in the same transaction. Explicit earmarks cannot exceed current account cash (including card repayment effects). Goal amounts do not create assets or move cash. Null links retain the original proportional remaining-cash display. Actual later spending can leave earmarks underfunded; further allocation writes revalidate current capacity. Plans are templates, not automatic payments. Stale embedded references reject activation until edited.
- Subscriptions: create/edit/pause/delete schedules, including owner-owned bank/card preferences. Schedules never post expenses or charges. The old chained Mark Paid flow is unavailable in authenticated mode; record the financial event in Expenses/Credit Cards and advance the schedule explicitly. Bank deletion is blocked while a subscription references it.
- Settings: safe GBP preferences, categories, budgets and paycheck assumptions persist with zero financial defaults. Existing-form versions are submitted with saves, so stale forms reject instead of overwriting newer settings. Secret/session/PIN fields and automatic allocations are not accepted. Notifications and AI remain disabled.
- Investments: owner-owned GBP investing accounts can hold exact position quantities (six decimal places), total cost basis and dividend history. This is record keeping: positions do not create purchase cash movements; dividends, including reinvestment markers, do not silently add cash or shares. Record actual cash movements separately once. Positions with dividend history cannot change symbol or be deleted until that history is handled. Reserved pseudo-cash symbols are rejected because account cash is already authoritative.
- Valuation: no live prices or market service is enabled. Position costs are not substituted for market prices. The dashboard shows incomplete net worth when positions lack current prices, and labels known cash minus debts separately. Recorded dividends are excluded from cash/net worth. Monetary tables honor Hide Balances.

The approved native shell remains. The Stocks route provides a styled authenticated record-entry view; the original demo portfolio view remains isolated. Failed saves retain form entries and show errors. The independent review found and closed four P2 issues: stale settings version substitution, demo route selecting authenticated commands, missing balance masking, and bank deletion leaving schedule references.

## Validation

- Docker unit suite: 106 tests / 22 files passed.
- Isolated PostgreSQL suite: 31 tests / 10 files passed, including ownership, malformed payloads, exact money, rollback/receipts, stale versions, concurrent settings creation, goal capacity and protected schedule references.
- TypeScript and production build passed with Next build networking disabled.
- ESLint: no errors; one existing internal-navigation warning in Credit Cards remains.
- Full browser candidate: 19/20 passed across laptop, iPhone WebKit, Android, foldable and 320px reflow. The iPhone continuation journey completed its persistence, no-extra-cash, stale-save and masking assertions but reported access-control errors on cancelled/background RSC prefetches; the focused rerun passed in 10 seconds. No UI changes were made for that rerun. The final server-only malformed-action guard was also present on the focused rerun. This is recorded as a WebKit navigation/prefetch flake, not a clean final full run.
- Native UI checks create/reload goals, schedules, positions and dividends; save preferences; reject stale settings while retaining the form; honor Hide Balances; and check overflow on the five routes. Existing bank/card/debt/PDF/lost-response journeys also passed all five profiles. No external requests were made.
- The final malformed-action/prototype-name guard passed focused PostgreSQL validation after the full suite, and the final production build passed.
- No dependency, schema or personal-record changes were required. The verified image was applied to the main local preview; only test services were stopped afterward. Work is committed and pushed to main with remote-head verification in the handover.

Only synthetic fixtures are used. Browser traces/screenshots must never be captured with private credentials or financial records. No dependencies or database migrations were added.

## Remaining gates

Atomic goal contribution transfers/automatic allocations, subscription payment-and-advance, investment trade/cash posting, market valuation, refunds/corrections, broader duplicate reconciliation and automatic snapshots remain separate work. Export/erasure/retention, versioned upgrade/rollback, backup/recovery rehearsal and idle locking remain adoption/release gates. No public compliance certification or manual deployment is claimed.
