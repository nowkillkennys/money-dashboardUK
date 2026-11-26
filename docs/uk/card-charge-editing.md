# Reconnected credit-card charge editing

The existing **Edit charge** action now saves through the authenticated transaction backend. Previously its adapter threw an unavailable-mutation error, and the original UI attempted separate charge and linked-expense saves. The dialog and fields are retained.

One `charge.update` command updates the charge and, when present, its existing linked expense. Amount, date, merchant, category and notes stay synchronized. Sharing, monthly exclusion and goal selection update the linked expense in the same transaction. Standalone charges remain standalone and do not silently acquire an expense. Bank balances, recurring flags, payment history, reported statement anchors and retained snapshots are preserved.

The form captures the charge, card and linked-expense versions when opened. It sends the raw decimal amount without silently rounding it. A stale save or validation failure leaves the dialog and draft values open. Duplicate submission/close guards apply during a pending save; a lost committed response retries with the same command key.

The backend validates owner, GBP card identity, manual-input flag, exact positive amounts, real civil dates, versions, nullable text fields, sharing bounds and goal ownership. It checks both directions of the expense link and rejects inconsistent records, including any linked expense that could affect bank cash. All writes and the receipt share one transaction; a late failure rolls back every change.

Amount/date edits to a charge already included in a statement, or already unresolved, mark its statement disposition unresolved for review in All Debts. The reported balance and original snapshot are retained. A metadata-only edit preserves disposition. An excluded charge remains excluded, with the tracked estimate updated; edits that make the known tracked balance negative or exceed the supported amount are rejected rather than silently clamped.

This fix covers editing charges. Individual charge deletion, repayment editing/deletion, linked refunds and broader correction workflows remain separate work. No schema migration or provider connection is required.

## Verification

Integration tests reproduce the unavailable command and cover linked and standalone edits, notes/reporting metadata, exact amounts, ownership/manual gate, stale versions, malformed fields, statement dispositions, unchanged snapshots, negative-balance rejection, retry replay, competing commands and full rollback after a late receipt failure. Browser coverage edits a linked charge and its sharing/exclusion metadata, loses a committed response, reloads both records, rejects a stale save with the draft retained, and edits a standalone charge without creating an expense.

Docker checks passed 108 unit tests across 23 files, 82 PostgreSQL tests across 15 files, typecheck and an offline production build. Lint has zero errors and one existing Credit Cards navigation warning. Independent review found an unlinked-charge payload issue; it was fixed and covered by the browser regression. No remaining P1/P2 findings were reported. All 50 browser tests passed across laptop, iPhone/WebKit, Android, foldable and 320px reflow, including the five new charge-edit journeys. The full run also covers card removal/order, subscriptions, shared bank/card/debt history, PDF review and lost-response handling. Browser emulation is not physical-device certification. All financial test records are synthetic and isolated in `db-test`; no personal card is edited for verification.

The tested production image is `sha256:b0e2923e8bc53a119738ba499337f1d805e2d6913706b3d8293be4648fe233dd`. It was applied to the existing main local preview; no database migration, credentials change or personal-record edit was needed.

After update the container is healthy, `/credit-cards` returns 200 and the private command endpoint returns 401 without a session. No private financial rows were read for verification.
