# Restored individual charge and payment deletion

The existing card-history delete buttons now call owner-scoped authenticated commands instead of unavailable adapters. Each confirmation describes its financial effects. Errors are shown on the page, and concurrent deletion clicks are blocked while a save is pending.

**Charge deletion** removes the selected charge and its existing linked expense in one transaction. It validates both directions of the expense link and refuses an inconsistent or bank-funded linked expense. Standalone charges remain standalone. Recorded repayments and bank cash are unchanged.

**Payment deletion** removes the main repayment record and retains its statement payment as voided. The original bank outflow disappears from the derived bank balance, restoring that amount in the app. It does not reverse a real bank payment, create an expense or edit a starting balance. An archived original bank is still a valid historical source; its ownership, GBP currency and observed version are checked.

Both commands check the manual-input flag, record/card versions, shared statement identity and, where relevant, linked-expense/bank versions. They use the existing receipt transaction, so all changes and the deletion receipt save together or roll back together. A retried request uses its prior result without deleting another record.

Reported balances and snapshot evidence are never rewritten by deletion. Migration 010 adds an owner-scoped account review flag, initially false. Deleting a statement-included/unresolved entry, or leaving a known estimate outside the supported non-negative range, marks the card for review. Its tracked balance is unknown and totals remain incomplete rather than displaying a fabricated or negative estimate. All Debts still shows retained statement/voided-payment history. Explicit reconciliation with a supported reported balance and inclusion decisions clears the flag and runs the normal balance validation; it does not silently resolve unrelated unknown charge/payment classifications.

Deletion is not a complete privacy-erasure operation. Statement snapshots, voided payment history, command receipts and private backups can retain information. Whole-card archive/permanent removal remains a separate choice.

## Checks and testing pause

The user explicitly paused tests until further instruction. No automated unit, database or browser tests, and no financial runtime journeys, were run or added for this restoration. Earlier test counts do not verify this change.

Source review covered transaction ordering, ownership/manual gates, stale versions, bank restoration, retained snapshots, receipt replay, statement-review flags and explicit reconciliation. An independent source reviewer reported no concrete P1/P2 issues. TypeScript compilation and the offline production build passed. Financial runtime behavior remains untested under the requested pause.

## Existing database upgrade

Migration 010 adds only a boolean review flag; it does not delete financial records. After a private backup, an installation already at migrations 001–009 can apply it once:

```sh
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml exec -T db psql -U postgres -d workspace -v ON_ERROR_STOP=1 < migrations/workspace/010-history-deletion-review.sql
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml up -d --wait workspace ingress
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml restart ingress
```

Fresh volumes use the initialization chain. A restart alone does not upgrade an existing volume. Do not reset financial volumes. When tests are explicitly resumed, the retained isolated `db-test` volume also needs migration 010 before its suite can use the updated ledger reader.

Local installation: migration 010 was applied after a private mode-0600 PostgreSQL backup. The built image `sha256:fae2b661e08c89b269d2bed26182baa7967c4c14bb6d29dfadf9b0824aa3546f` is running and the service reports healthy. No financial runtime requests were made and no personal charge or payment was deleted during this restoration. Backup restore testing was not performed.
