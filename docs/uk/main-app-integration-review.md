# Main application integration review

Reviewed the authenticated main application transport, command journal, native/debt ledger bridge, owner-scoped reads and reconciliation paths on 2026-11-26.

The two review findings are closed in source:

- Partial transaction updates preserve the existing `goal_id` and `received_amount` when those fields are omitted; an explicit null still clears them.
- Linked card expenses validate GBP currency, recurrence, personal share and supported override fields, and persist goal and recurrence details. Unsupported currency or invalid recurrence is rejected rather than silently discarded.

The journal reserves owner-scoped commands before financial execution, replays the saved envelope using the same key, and uses financial receipts to settle already committed commands. SQLSTATE classes 22 and 23 become definite HTTP 400 rejections and release the pending command barrier. RLS scopes journals, receipts and referenced financial records to the authenticated owner. Main-data reads use one repeatable-read transaction; PostgreSQL civil DATE values remain strings rather than timezone-shifted instants.

The coordinating agent reports 26 PostgreSQL integration tests passing in the isolated `db-test` environment, including all five journal security tests covering reserved-command recovery, invalid SQL/foreign-key rejection, same-key conflicts, hidden foreign pending commands and cross-owner dereferences. The coordinating agent also reports the first native browser pass completing all flows across five profiles; the legacy snapshot effect was subsequently disabled for the authenticated path and the coordinating agent reported all 15 browser checks passing. This final source check did not rerun those suites.

Auxiliary authenticated mutations that have not been implemented remain explicitly unavailable. They do not fall back to fixed-owner legacy writes. Cloud sources are disabled. No real statement PDF, cloud credentials or personal user database were used for this review. Application of migrations 006/007 was subsequently performed by the coordinating agent as additive DDL, with the existing login and main-data status verified. This reviewer did not access that personal database.
