# Card deletion and saved ordering

The subsequent [card removal choices](card-removal-choices.md) update supersedes the unused-card-only UI policy below. The safe command remains available for backward compatibility.

26 November 2026. Changes apply to the authenticated main app on port 13022.

## Cause and behavior

The Delete button called an authenticated adapter that deliberately threw an unavailable-mutation error. Its UI handler did not catch the rejection, so the card remained without useful feedback. Card deletion is now an owner-scoped, versioned command inside the existing idempotent receipt transaction.

Only an unused zero-balance card with its original automatic opening snapshot can be deleted. Charges, repayments (including pending/voided records), reviewed/manual/PDF statement evidence, confirmed imports and linked subscriptions protect the record. The visible restriction offers **Edit card to archive**; check **Archived** and save. Archiving sorts the card below active cards and preserves its balance and financial history. It does not erase debt or reverse bank effects.

Migration `008-card-deletion.sql` adds a narrowly granted security-definer function with a fixed search path and explicit owner checks. It does not grant general deletion of statement history. Existing subscription references are compared case-insensitively so uppercase UUID text cannot bypass bank/card deletion protection.

Bank/card reordering previously used unavailable authenticated adapters. Saving now sends one complete owner list, including archived entries, with the versions the user actually saw. Validation and all position updates are atomic; stale/foreign/partial/duplicate lists fail without partial changes. Reads respect saved positions. Pointer and keyboard sorting are supported, and rejected saves restore the displayed order and show an error. The shared drag handle preserves its button identity and focus across drag renders, with an explicit activator ref; browser checks assert keyboard focus.

## Verification

Regression tests reproduced the original deletion failure and the uppercase-reference bypass before fixes. Docker lint has zero errors and one existing internal-navigation warning; typecheck, production build, 106 unit tests and 52 PostgreSQL integration tests pass. Database checks cover ownership, feature/version gates, exact history preservation, receipt replay, restricted SQL privileges and atomic ordering. Independent source review found no remaining P1/P2 issues after the reference fix.

All 30 browser tests passed across laptop, iPhone/WebKit, Android, foldable and 320px reflow layouts. This includes ten new maintenance cases covering deletion/reload, protected history, working archive persistence, keyboard focus, saved ordering and rejected ordering. Initial failures identified an ambiguous alert selector, sensor timing in the test and the drag-handle focus remount; the final complete suite passed. Tests use isolated synthetic users in `db-test`, never personal card records.

The existing local database received migration 008 after a private mode-0600 custom-format backup whose archive directory was validated. No private records were queried for verification, reset or deleted. The production image is `sha256:4bbd241d7db94c4c43a7a56d2b4c212cdd30f7f734b6472724270d8744caeefd`; the preview update retains existing credentials and database volumes. After update the container is healthy, `/` returns 200, `/workspace` redirects to `/debts`, and unauthenticated `/api/workspace/main-data` returns 401.

## Existing database upgrade

Fresh volumes apply migration 008 automatically through the initialization chain. Existing volumes require a private backup and explicit application of the additive migration; a container restart alone does not apply it. With migrations 001–007 already present:

```sh
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml exec -T db psql -U postgres -d workspace -v ON_ERROR_STOP=1 < migrations/workspace/008-card-deletion.sql
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml up -d --wait workspace ingress
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml restart ingress
```

Apply 008 once; it intentionally creates a new function. Do not reset the database or use `down -v`. A private local dump is a precaution, not a demonstrated recovery/rollback system. General backup/restore and upgrade tooling remain outstanding.
