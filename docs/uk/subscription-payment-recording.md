# Reconnected subscription payment recording

The existing **Mark as Paid** action is available in the authenticated main app again. It records an already-made payment; it does not initiate a payment to Netflix, a mobile provider or any other company.

The dialog confirms payment date and a bank account or card. It uses the schedule amount and frequency stored on the server. Creating or editing a schedule does not post any cash movement. Choosing another source for a single payment does not change the schedule's default payment account.

One command records a bank expense, or a card charge with exactly one mirrored expense, and advances the schedule by one billing cycle. Bank payments reduce bank cash. Card payments increase tracked card debt without reducing bank cash or duplicating spending. Card statement identity, exclusion disposition and reconciliation rules remain shared with Credit Cards and All Debts. Unresolved statement items stay unresolved.

The command checks the subscription and source versions shown to the user, owner, active state, GBP currency, positive exact amount, real civil payment date and expected billing date. Manual input must be enabled. Payment and billing updates share the existing transaction and receipt journal. A failure rolls back every insert/update; retries reuse the same key, and competing new keys for the same observed cycle cannot create another payment. A stale save keeps the dialog inputs and asks the user to refresh and review.

Billing advances from the scheduled due date, not the payment date, and advances one cycle even when overdue. Monthly/yearly dates clamp to the destination month's last valid day: 31 January → 28 February, and then 28 March on the following monthly cycle. This slice does not persist an original day-of-month preference. Weekly and fortnightly cycles add seven/fourteen civil days. Date calculation is independent of the host timezone; the default payment date uses Europe/London.

The modal blocks duplicate submissions and closing during a pending request, filters archived sources, masks the payment amount with Hide Balances, and uses the same calendar helper as the server. It rejects unsupported calendar advancement without crashing the page.

## Verification

Database regression tests cover exact bank/card effects, receipt replay, two competing keys, stale schedule/source versions, ownership, paused/archived/non-GBP/zero schedules or sources, strict fields/dates and full rollback after financial inserts. Calendar unit tests cover month-end, leap year, early years and overflow. Browser tests cover both payment sources, lost committed response replay, reload persistence and stale-save input retention.

Docker verification passed 108 unit tests across 23 files and 63 PostgreSQL tests across 14 files. Typecheck and an offline production build passed; lint has zero errors and one existing Credit Cards navigation warning. Independent source review found no P1/P2 issues. The full browser run passed 44/45 across laptop, iPhone/WebKit, Android, foldable and 320px reflow, including all ten subscription cases. The older iPhone feature journey encountered a WebKit internal navigation error going to Reports; the unchanged focused rerun completed its financial assertions but caught a cancelled main-data request in its final error check. Explicit waits for the initial authenticated data and for data completion before each hard navigation/reload corrected that test race; the iPhone journey then passed without a product-code change. This is not a clean complete-suite pass or physical-device certification. Tests use synthetic users in the isolated test database. No schema migration, provider connection or personal-record mutation is needed to reconnect this feature. Automatic detection, external notifications, automatic payment posting and already-recorded transaction matching remain separate work; record a payment here once, rather than also entering it manually elsewhere.

The tested production image is `sha256:a20d03375b8e50e10756ea1bf696b1bfe242da4c899352dcd9b0c7ad7eaef049`. It was applied to the main local preview without schema changes, credential changes or personal-record migration.

After the local update the container is healthy, `/subscriptions` returns 200, and the command endpoint returns 401 without a session. No authenticated personal-record checks were performed.
