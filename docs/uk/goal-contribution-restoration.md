# Restored goal contributions

The existing **Add Contribution** action is wired to the authenticated main app again. The old shared-owner `/api/contribute` route stays blocked; one `goal.contribute` command now saves the recorded transfer and selected fixed-allocation changes in the existing owner-scoped transaction and receipt journal.

The form confirms source account, linked destination, amount and contribution date. It captures the goal and account versions on opening. Stale saves retain the draft and ask for a refresh. Duplicate submission and closing are blocked during a pending save. This records a transfer already made; it does not initiate a bank transfer. Do not also enter the same transfer separately: matching an existing transfer is not implemented.

Only active GBP accounts and incomplete goals are available. The destination must be linked to the goal, including the retained single-account link fallback. Source and destination must differ. The server validates real civil dates, positive exact amounts, explicit adjustment flags, versions and the manual-input setting. It locks accounts in a fixed order and reuses the existing idempotent receipt handling.

Fixed earmarks can optionally decrease at the source and increase at the destination. A decrease cannot exceed the existing fixed amount. Automatic/null links remain automatic: their adjustment controls are disabled, and the server rejects attempts to turn them into fixed zero-based amounts. They continue sharing available account cash under the existing goal-progress rules. Users can change an allocation mode explicitly through Edit Goal.

Before saving the transfer, the command checks the resulting cash in both accounts against all fixed goal earmarks, including other goals and bank-funded card repayments. It cannot spend cash reserved for another goal. One transfer changes the two cash balances without creating an expense or an extra asset. Updated links, goal and account versions save with the transfer and receipt, or roll back together.

## Checks and testing pause

The user explicitly paused test suites until further instruction on 26 November 2026. No unit, database, browser or financial runtime tests were run or added for this restoration. Earlier passing test counts apply to earlier releases, not this change.

TypeScript compilation and the offline production build passed. Source review covered ownership, receipt handling, fixed-versus-automatic allocations, cash/earmark arithmetic, captured versions and legacy linked-account handling. The source reviewer was interrupted before completing the entire UI review; the parent agent completed the remaining source inspection and fixed the legacy-link mismatch. Runtime behavior remains untested under the requested pause.

No schema migration, external provider setup or personal-record changes are required. The built local image is `sha256:2f4c3139a3ab72370aefb6cebf3459dd25960e3c30ecfe7e1feae21cc2d1d184`.

See [remaining disconnected actions](disconnected-actions.md) for the source audit and outstanding restoration work.

The main preview was updated to that image and its service reports healthy. No financial requests or runtime journeys were executed during this restoration.
