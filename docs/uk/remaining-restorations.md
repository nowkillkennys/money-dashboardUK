# Remaining authenticated migration restorations

Implemented on 26 November 2026 in the existing authenticated app, preserving its UI and owner-scoped database boundary.

## Linked refunds

Bank income and non-bank card credits can link to an original expense. Creation and editing validate ownership, GBP, dates and the combined refund amount across both methods. Card refunds must match the original card purchase. Refunded originals cannot be deleted or edited into an inconsistent amount/date/type. Removing a refund releases its amount. A card credit that invalidates the tracked debt estimate requires reconciliation instead of inventing a balance.

Migration `011-linked-refunds.sql` adds nullable links and constraints and updates confirmed whole-card removal. Retained bank refunds are unlinked when their original card expense is removed. Unexpected cross-card refund links block whole-card removal until unlinked. Existing rows are otherwise unchanged.

## Bank duplicate reconciliation

The existing reconcile screen now creates workspace sessions and supports merge, explicit deletion and keep-both. Both displayed records, the session and account must retain their observed versions. Merge retains the chosen record without summing amounts; keep-both applies to that session. Transfers, card-linked expenses, protected card repayments and refund-related records are excluded from duplicate candidates. Balance comparison includes all history through the selected end date; the start date limits candidate search. An expected balance does not silently create a correction.

## Daily overview snapshots

Opening or remaining on the authenticated overview captures the current London day when manual tracking is enabled and valuations are complete. The owner loaded by the dashboard must match the active session. A unique owner/day upsert avoids duplicate captures; existing historical dates are preserved. The chart reflects capture on its next data load.

Capture skips unresolved debt, unsupported currency and positive investment holdings without market valuations. It does not substitute cost basis or dividend records for current asset value. This is capture during overview use, not an unattended scheduled job or a live-price integration.

## Verification and operations

TypeScript compilation and the production image build passed. Independent source reviews found no remaining concrete P1/P2 findings after fixes. No unit, PostgreSQL, browser or financial runtime tests were run or added: the user pause remains in force. Earlier release test counts do not verify these changes.

Back up the retained local database before applying migration 011. Existing volumes do not apply migrations merely by restarting. The retained test database will need migrations 010 and 011 when the user explicitly resumes tests; do not reset financial volumes.
