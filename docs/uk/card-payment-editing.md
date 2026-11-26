# Reconnected credit-card repayment editing

The existing **Edit payment** action now saves through an authenticated `payment.update` command. Previously the adapter always threw an unavailable-mutation error. The existing editor keeps its amount, date and Paid from fields.

One save updates the original card payment and its linked statement payment together. Correcting the funding bank removes the original outflow from the old bank and applies the corrected amount to the selected bank through the same payment record. Choosing card credit/cashback removes bank funding without inventing an expense. Choosing a bank for a previously unfunded credit applies that bank outflow. This edits app records; it does not send money or alter a real bank transaction.

The editor captures payment, card and bank versions when opened. The server requires exactly the old/new funding banks' versions, validates ownership and GBP, locks those banks in a fixed order, and rejects stale saves. A current archived source may be retained or corrected historically; another archived bank cannot be chosen as the new source. A stale/invalid save leaves the draft visible, and pending saves block duplicate submission and closing. Raw decimal amounts are validated without silently rounding.

Card/statement payment identities and status remain unchanged. Pending, voided, missing or inconsistent statement links are rejected for review in All Debts. Amount/date changes to an included or unresolved payment require statement reconciliation again. Source-only changes preserve the existing statement inclusion. Reported statement anchors and snapshots are not rewritten. Known tracked balances cannot become negative or exceed the supported amount. A correction creates no expense or transfer and does not duplicate payment history.

The command shares the existing manual-input flag, per-user transaction and idempotent receipt journal. Payment, statement, card/bank versions and the receipt either save together or all roll back. A lost response retries the same key. Concurrent requests for the same observed payment cannot both apply.

This slice does not implement individual payment deletion or linked purchase-refund handling. The authenticated editor labels unfunded amounts as card credit/cashback and does not offer the legacy refund linker. No schema migration or external provider connection is needed.

## Verification

Nineteen new isolated PostgreSQL cases cover bank-to-bank, bank-to-credit and credit-to-bank cash effects, no expenses, amount/date corrections, source-only changes, versions, ownership/manual mode, strict fields/real dates, archived and non-GBP sources, status/link consistency, immutable snapshots, statement review, negative-balance rejection, replay, concurrent saves and late-failure rollback. The browser journey edits through all three funding transitions, drops a committed success response to test replay, reloads persistence, and checks stale-bank rejection with draft fields retained.

Docker build/typecheck and all 108 unit tests pass. The full PostgreSQL suite passes 101 tests across 16 files. Independent source review reported no P1/P2 issues. All 55 browser tests passed across laptop, iPhone/WebKit, Android, foldable and 320px reflow, including the five new repayment journeys and existing charge/card removal/order, subscription, bank/debt/PDF and retry regressions. Lint has zero errors and one existing Credit Cards navigation warning. Browser emulation is not physical-device certification. All test records are synthetic in `db-test`; no personal payment is edited for verification.

The tested production image is `sha256:85819b06c6fe7d17d1f05cbaa0de655faffccdd872bee6f2645edfa5ffbbdc0f`. It was applied to the existing local main preview with no schema, credentials or personal-record changes.

After updating the preview, the container is healthy, `/credit-cards` returns 200 and the command endpoint returns 401 without a session. No private financial records were read for verification.
