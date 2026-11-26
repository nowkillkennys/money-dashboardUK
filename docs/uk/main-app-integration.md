# Main application integration — 26 November 2026

The authenticated product now uses the original Money Dashboard shell and native routes at http://127.0.0.1:13022/. `/workspace` remains a bookmark redirect to `/debts`; the standalone workspace was an intermediate domain/security seam, not the target product. The user's existing local login is retained. No original application or real financial database was reset, imported or replaced. No external financial/model service or public deployment is enabled.

## Connected vertical slice

- The original overview, accounts, income, expenses, credit cards and reports consume one authenticated, owner-scoped main read model. Existing goals, allocations, subscriptions, holdings, dividends, snapshot and reconciliation implementations and relationships are preserved in source and in the adapted `money_*` schema. Their unported mutation adapters explicitly reject changes rather than writing through the old shared-owner gateway. This slice does not claim every original feature is now editable.
- Native bank creation/editing/archiving, income/expense/transfer commands, card creation/editing, charge recording, linked card expenses and repayments use typed transactional server commands. Existing schema names and owner-scoped relationships are retained; no financial sample records are seeded into a personal account. Settings defaults contain zero financial assumptions.
- A card and its statement anchor share an explicit identity mapping. Creating a card from either connected flow creates that identity once. Existing workspace-only cards can be explicitly connected with their current ID/balance/date retained. Until connected, their liability still contributes once to the overview. No automatic real-record migration occurs.
- A linked card purchase writes one charge and one linked reporting expense atomically; bank cash is not deducted at purchase. A bank-funded repayment writes a canonical repayment plus its same-ID statement projection atomically, reduces the bank balance once and the debt once, and creates no second spending expense. Card correction-only charges do not invent spending. Bank accounts with financial references cannot be deleted as a shortcut to unlinking history.
- All Debts remains in the main navigation beside Credit Cards. PDF review/reported snapshots use the same card identity, payment history and versions. New statements explicitly classify both charges and posted payments; pending items remain separate. Unknown classifications are visibly excluded from complete totals. Voiding a recorded bank-funded repayment reverses the linked bank effect in the same transaction; a payment already included in a reported statement requires reviewing a corrected statement first.
- Account running balances are served from the same authenticated snapshot, including canonical card repayments once. Original native income/expense/account views use that route. Civil PostgreSQL DATE values are returned as date strings, avoiding invalid native date formatting and BST day shifts.
- Durable owner-scoped command journals reserve the intent before execution. Financial receipts settle already committed requests; retries after response loss reuse the key. Reload recovery exposes only opaque operation IDs to the browser and replays server-held payloads. Definite validation/FK rejections release the barrier; ambiguous errors retain it. Body/identity/origin checks and RLS remain mandatory.

## Verification

The combined candidate builds with external networking disabled for the Next build. Docker unit tests, PostgreSQL integration tests and native browser evidence are recorded in the final verification entry below. Independent review in main-app-integration-review.md led to regression fixes for native recurrence/goal retention and partial transfer edits preserving received amounts.

The native browser journey creates a bank with £1,000, adds a card, records a £100 linked purchase and a £25 bank-funded repayment. It verifies £975 cash, £75 liability, one £100 expense, £900 net worth and the same card identity in All Debts. All native menu pages load without external requests or page errors. The parallel PDF/retry journeys use synthetic loans and the same main shell. Browser emulation is not physical-device certification.

The only original framework API still intentionally reachable as a compatibility read is an explicitly offline stock response; no provider is contacted. AI, voice, push and legacy shared-owner mutations remain blocked. Unported automatic snapshots/AI categorisation are skipped, not silently advertised as live services.

## Remaining scope

Next adapters: goals/allocations, subscriptions, holdings/dividends and market-data absence handling, financial correction/refund/edit flows, duplicate reconciliation and automatic snapshots. Their original useful source is retained. Bank/debt broader reconciliation, operational migration/rollback bookkeeping, backups/recovery, retention/export/erasure, idle locking and release hardening remain tracked requirements. No certification or whole-product migration completion is claimed.

## GitHub access

Read-only checks confirmed the local GitHub account `nowkillkennys` is authenticated and has push/admin permission on `nowkillkennys/money-dashboardUK`. Origin points there; original upstream is retained. The user subsequently authorized updating `claude.md` and pushing the completed feature branch on 26 November 2026. This does not authorize merging to main or deployment. No token was printed or requested from the user. The push result and exact remote commit are verified and reported in the handover.

## Final local verification

- Docker unit suite: **106 tests / 22 files passed**.
- Separate db-test PostgreSQL suite: **26 tests / 7 files passed**. Includes preserved recurrence/goal/received amounts, BST civil dates, account ledger repayment effect, card adoption and journal recovery/security.
- Full browser suite: **15/15 passed**, five layouts each exercising native main-app ledger, PDF review and lost-response retry/logout. A final main-only rerun passed four profiles but hit a WebKit internal navigation error on iPhone; the unchanged-code focused iPhone rerun passed. This test-engine flake is retained as a limitation, not hidden as a clean final full run. Zero page errors/external requests on the native journeys; narrow layouts checked for overflow.
- ESLint and TypeScript no-emit passed; final Next production build passed with build networking disabled. Dependencies were unchanged from the recorded remediated lockfile.
- Additive migrations 006/007 were applied to the local application database after isolated checks. No existing financial rows were rewritten or seeded. The existing personal login was verified against the deployed main-data endpoint (200/no-store); no personal financial values or credentials were printed/saved. Only the verification session was revoked.
- Git diff whitespace check passed; MIT LICENSE unchanged. Implementation is committed locally; the subsequent user-authorized feature-branch push includes this recorded evidence.

The existing synthetic comparison demo and older original/implementation applications remain separate and their data was not imported automatically.
