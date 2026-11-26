# Atomic income allocation saving

The existing income form previously saved income and each allocation transfer using separate commands. A later failure could leave income and only some transfers committed.

Authenticated split submission now uses one `transaction.create` command containing the selected allocations and observed versions of the deposit and destination accounts. Its existing owner-scoped database transaction, manual-input gate and idempotency receipt cover the income and every transfer together. Any validation or insertion failure rolls all of them back. A recovered command returns the same receipt instead of repeating transfers.

The server requires active owned GBP accounts, distinct destinations, positive split amounts, no more than 100 destinations and a total no greater than the income amount. Totals use exact integer pennies. Allocations are accepted only for new ordinary income, not refunds or updates. Account versions advance together. No new schema or external service is involved.

Saved allocation templates still prefill editable amounts; there is no automatic plan application. Existing income and transfers remain separate history records after creation: this change does not introduce grouped editing/deletion. Legacy/demo submission is unchanged. After a successful save the form resets before refreshing, so a failed refresh does not invite resubmission of the committed income.

TypeScript and production-build verification are recorded for this change. No runtime journeys or automated tests were run or added while the user testing pause remains active.
