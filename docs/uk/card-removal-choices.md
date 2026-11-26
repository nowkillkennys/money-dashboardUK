# Card removal choices

The authenticated Credit Cards page now offers Archive, Permanently delete and Cancel in a removal dialog. This supersedes the previous UI restriction that only unused zero-balance cards could be removed.

Archive hides a card from the default active grid. Its liability and history remain in totals; **Show archived** reveals it with **Restore card**. Archive does not settle or erase debt.

Permanent deletion requires an owner-scoped preview and the exact card name. The dialog shows tracked balance or unresolved status and counts of charges, linked expenses, payment records, statement snapshots, confirmed PDF imports and subscriptions. It removes the card and those card records, including mirrored expenses, so spending history and current debt totals can change. Existing aggregate net-worth history is retained. Deleting a card from this app does not settle a lender balance.

Bank-funded repayments are retained as explicitly marked read-only outgoing transfer records to a removed card, preserving bank balances without adding spending. Subscriptions remain with their payment account unlinked. Command receipts/journals and private backups may retain information; this is not a complete privacy-erasure workflow.

The preview token hashes the complete relevant dependency state. Deletion rechecks the token, exact name, versions, owner and manual-input flag while holding the shared command lock. A changed dependency requires a fresh preview. A narrow SQL function enforces these checks even on direct invocation; general deletion privileges for ledger history remain unavailable. The existing unused-card command remains backward compatible. Confirmed deletion receipts support safe replay.

Migration 009 is additive: a marker on retained bank transactions and narrowly granted preview/deletion functions. Existing databases need the migration explicitly, after a private backup; restarting a container does not apply it. Fresh volumes use the normal initialization chain. No financial records are automatically deleted by the migration.

## Validation

Synthetic integration and browser tests cover removal with a balance/history, preserved bank cash, subscription unlinking, archive/restore, typed confirmation, stale dependencies, ownership, feature/version gates and receipt replay. Docker production build and typecheck pass; lint has zero errors and one pre-existing Credit Cards navigation warning. All 106 unit tests and 57 PostgreSQL tests pass. Independent review found and resolved an unsafe editor for retained transfers; no remaining P1/P2 findings were reported. The full browser suite passed 33/35: the two iPhone/WebKit failures were final page-error checks reporting background navigation/request access-control errors after financial assertions completed. The unrelated iPhone feature journey passed unchanged on rerun. The archive journey reproduced a test race: it navigated away before initial hydration/save completion. Explicit waits for loaded data and completed UI actions fixed that race; all three iPhone maintenance journeys then passed without product changes. The final maintenance run passed all 15 tests across laptop, iPhone/WebKit, Android, foldable and 320px reflow layouts. A synthetic dialog screenshot was visually inspected. Browser emulation is not physical-device certification. No personal card is used for deletion tests.

For an existing installation with migrations 001–008 already applied, back up privately, then apply 009 once before starting the new image:

```sh
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml exec -T db psql -U postgres -d workspace -v ON_ERROR_STOP=1 < migrations/workspace/009-permanent-card-deletion.sql
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml up -d --wait workspace ingress
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml restart ingress
```

Do not reset financial volumes. This local backup precaution does not replace a demonstrated recovery/rollback system. Preserved bank payments cannot currently be corrected through the normal transfer editor; they are visibly read-only and guarded on the server.

Local migration 009 was applied after a private mode-0600 custom-format backup with its archive directory validated. The deployed candidate image is `sha256:af7bec58f7939bf5fbacbf0242e68dd366245c4a841c60ac63ca3f02ea46847d`. Existing credentials and volumes remain unchanged; no personal card was deleted.

After updating the local preview, the container is healthy, `/credit-cards` returns 200 and the removal-preview endpoint returns 401 without a session. Migration-function presence was confirmed without querying personal records.
