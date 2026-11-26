# UK Money Dashboard — accepted direction

The user selected https://github.com/nowkillkennys/money-dashboardUK as the application base on 26 November 2026. Retain https://github.com/NightBaRron1412/money-dashboard as upstream and preserve MIT notices. This decision supersedes the old recommendation to evolve Debt Tracker as the main app. After the user detached the repository, GitHub API verification on 26 November 2026 confirms it is now standalone (`fork: false`). Original upstream attribution and MIT obligations remain. The user explicitly authorized pushing the completed integration into `origin/main`, superseding the earlier feature-only authorization. Public deployment and provisioning services remain outside this request.

## Approved continuation — 26 November 2026

The user reviewed the UK demo and approved the base/interface and continuation: authentication, per-user isolation and dependency remediation first, followed by tested debt reconciliation and PDF imports. Preserve the approved interface; do not reopen aesthetics. Credit Cards remains a card-specific view within a broader debt grouping. The new authenticated local foundation is separate from the synthetic demo and from the former apps. No real records are migrated automatically.

Current absolute session lifetime is eight hours with server-side revocation. The user proposed easy return after idle with a PIN. Idle/PIN unlock is not implemented: design a server-enforced lock/re-authentication state separately, never a client-only cover or the old household PIN. No external AI credentials or configuration is authorized.

## Main-app integration requirement

The user explicitly reaffirmed adapting the original integrated MAIN APP/routes and schema. The standalone workspace is intermediate only. Keep the original feature-rich shell, existing account/transaction/card/goal/allocation/subscription/holding/dividend/reconciliation/snapshot/notification implementations and relationships. Connect them to server-derived ownership and transactional financial commands. Do not call the entire original app a demo or rebuild a separate debt product. No duplicate financial authorities: shared card identity, linked expenses, bank-funded repayments and statement anchors must stay consistent. See docs/uk/main-app-integration.md for the current vertical slice and unported adapters.

## Current delivered integration and evidence

The authenticated main app runs locally at http://127.0.0.1:13022/ using the approved original shell. `/workspace` redirects to `/debts`. The existing username and password remain unchanged; never place credentials in source, documentation or logs. The synthetic demo and former apps remain separate, with their real-data databases untouched.

Overview, accounts, income, expenses, credit cards and reports read the original-shaped per-user ledger. Native bank/card/transaction commands, shared card identities, linked purchase expenses and atomic bank-funded repayments use one financial authority. All Debts and PDF review reconcile against the same anchors and payment/charge history. PDF extraction produces typed observations for explicit review; it does not silently replace balances or retain full card numbers/names. Repeat imports and command retries are protected against duplicate effects.

Goals/earmarks/allocation templates, subscription schedules, safe settings, holdings and record-only dividend WRITE adapters are now connected to the same journal/receipts. See docs/uk/main-feature-continuation.md for conservative no-cash-posting semantics, valuation limits and verification. Atomic contributions/automatic allocation, investment trade/cash posting, correction/refund flows, broader duplicate reconciliation and automatic snapshots remain; do not describe this as a complete migration.

Current restoration/testing status: Goal contributions are reconnected with compilation/build and source inspection only; runtime tests are explicitly paused until the user requests them. See docs/uk/goal-contribution-restoration.md and docs/uk/disconnected-actions.md. The following test counts are historical for the preceding repayment-edit release, not verification of the new goal contribution command.

Latest continuation evidence: 108 unit tests across 23 files, 101 PostgreSQL tests across 16 files and all 55 browser tests across the five configured layouts passed. This includes repayment/charge editing, card removal/order, subscription recording, debt/PDF and retry journeys. Typecheck and offline production build passed; lint has zero errors and one existing Credit Cards navigation warning. See docs/uk/card-payment-editing.md for scope and limitations. Main preview uses the verified image, with no schema changes or personal-record edits.

## Repository publication status

Current implemented work is pushed to `origin/main`: `5bab5cf` (safe deletion and saved ordering), `199a75e` (user choice of archive or confirmed permanent deletion), and `3e16190` (atomic subscription payment recording). On 26 November 2026, a fresh fetch verified local main and origin/main matched at `3e16190` with a clean working tree before this handover refresh. The user confirmed the removal choices worked. README and the feature-specific verification documents describe the completed behavior and limits.

The completed feature branch was pushed and verified at `6cb5794`. The user subsequently authorized integration into `origin/main` on 26 November 2026. Main was an ancestor of the verified feature, so a normal fast-forward preserves all history. Preserve the feature branch and verify the remote main head against the integrated local commit; never force-push. No manual deployment is authorized. No GitHub Actions workflows are tracked or currently listed; hosting integrations may still react to a main push, so do not claim that remote publication cannot trigger deployment. Keep the upstream remote and MIT LICENSE/notices intact. `.uk-work`, credentials, environment files, real statements/extracted text and generated test artifacts must stay excluded. Committed fixtures and the verification screenshot are synthetic.

## Product intent

Personal UK use first, future public multi-user service. Unified bank and debt accounts, transactions, budgets and future balances inspired by the discontinued Money Dashboard experience, easier to use and extended with debt/product/repayment detail. Preserve the new base's useful UI and workflows while proving persistence and correctness.

- Keep bank assets and debt liabilities distinct; show clearly labelled net worth without disguising debt as available bank money. Avoid double-counting transfers, card payments, purchase components and overlapping obligations.
- Reported balance anchors and tracked estimates use exact money, explicit statement/payment inclusion, source/as-of and uncertainty. Owner-scoped transactional/idempotent/versioned mutations and repeat import safety are non-negotiable.
- User-controlled repayment comparisons show pounds, interest **and fees**, payment effect, payoff and long-run cost with explicit assumptions. Never substitute simple annual rate for APR, forecast interest for posted charges, or a conditional percentage fee for a money fee total.
- Support monthly-fee products (including supplied118118example), BNPL/Very purchase plans and interest-free expiries; one Frasers account with shop-tagged purchases/plans, subject to validated allocation/terms. Do not sum purchases again into the account balance.
- Retain manual and file-statement methods. Port tested PDF extraction/review throughfbf24ee: missing/ambiguous candidates, typed simple annual rates/forecast/conditional fees, optional last-four suggestions, no names/fullPAN retention, explicit account mapping/reconciliation, hash deduplication and retry safety. Synthetic committed fixtures only. Real statements never go to Gemini or other services.
- Independently controlled retrieval modules. Enable Banking is proposed only; coverage, pricing/access and permissions remain unverified. Browser-led Very login/MFA stays separate with no lender-password collection. Email is separately authorized. No connector is working because a browser or placeholder opens.
- Responsive laptop/iPhone/iOS Safari/Android/foldable flows with touch/keyboard/accessibility checks; emulation is not physical-device certification.
- FCA perimeter/personalised advice/referrals, UK GDPR/PECR, consumer rules and accessibility require applicability evidence and appropriate review before public/paid release. No compliance certification is claimed. Retain root historical compliance register as evidence needing re-verification at launch.

## Safety and migration

The old original and implementation checkouts and their real-data preview must remain intact. Do not reuse/reset those databases, fixtures or credentials. No actual user data enters this demo. Keep Next/React as the selected UI base, inspect and harden identity/tenancy/session/persistence before real-data import. Never allow dual unsynchronised writers for the same balance. Design reviewed export/dry-run/reconciliation/rollback before migrating records.

All tests run in Docker. New features require independently persisted/enforced flags before real use. Preserve upstream tests and record failures honestly. Inspect dependency lifecycle scripts before execution; lock versions and avoid blind installs. Do not connect cloud services, AI, market APIs, external financial accounts, or publish a preview without authorization. The current UK_DEMO_ONLY boundary is a local evaluation mechanism, not production auth.

See README.uk.md, docs/uk/product-migration-plan.md, docs/uk/upstream-security-review.md and docs/uk/verification.md. Full inherited intent/audit is preserved in docs/uk/legacy-requirements-reference.md; its earlier base recommendation is historical, not the present decision.

## Card maintenance continuation — 26 November 2026

Historical first fix: the later user-approved removal choices below supersede its unused-card-only UI restriction.

Card deletion now reaches an owner-scoped transactional command instead of the unavailable adapter. Only unused zero cards and their automatic opening record are removable; history/subscriptions require archive, with a direct Edit Card action. Migration 008 grants only the narrow checked deletion function, not raw history deletion. Subscription guards handle uppercase UUID text. Bank/card ordering is a single complete-list versioned command, persists position ordering and supports keyboard interaction. See docs/uk/card-maintenance.md for verification and upgrade notes. Keep the main app on 13022; stale mockup replies are not a new design task.

Verification: 106 unit, 52 PostgreSQL and 30/30 browser tests passed across all five configured layouts. Typecheck/build passed; lint retains one existing navigation warning. Independent review found no outstanding P1/P2 findings. Migration 008 applied to the existing local preview after a private backup; no personal records deleted or reset.

## User-approved card removal choices

User explicitly requested both Archive and Permanent delete options and approved the concrete dialog design. Archive hides active-grid cards with Show archived/Restore while retaining liability. Permanent deletion requires exact typed name and a fresh dependency preview token; it removes card history/mirrored expenses, preserves bank-funded repayments as marked read-only transfers, and unlinks retained subscriptions. Do not restore the blanket history restriction in the UI. Migration 009 adds the narrow operation and marker; no user card is to be deleted by development/testing. See docs/uk/card-removal-choices.md.

Removal-choice verification: 106 unit and 57 PostgreSQL tests pass; all 15 final maintenance browser cases pass across five layouts after fixing test waits around hydration/save completion. Broad suite was 33/35 due WebKit background-request errors; unrelated failed journey passed unchanged on rerun. Build/typecheck pass, one pre-existing lint warning. Migration 009 applied after a private backup; preview uses tested image, no personal cards deleted. Retained payments are visibly read-only and server-guarded to prevent an ordinary transfer edit crediting an unrelated bank.

## Subscription payment reconnection

User approved reconnecting the existing Mark as Paid flow rather than inventing a new feature. Authenticated subscription.pay records one exact bank expense or card charge plus one mirrored expense, and advances one scheduled cycle in the same receipt transaction. Observed schedule/source versions and expected due date prevent stale/duplicate postings. Shared UTC calendar clamps each successive cycle, London default payment date. This records payments already made, does not send money, and does not auto-match existing manual transactions. No schema changes or personal records altered. See docs/uk/subscription-payment-recording.md for verification and limitations.

Subscription verification: 108 unit/63 PostgreSQL pass; all 10 new browser cases pass across five layouts. Broad run44/45, older iPhone journey had internal-navigation/cancelled-data errors; data-loading waits corrected its test race and focused rerun passed. Build/typecheck pass; lint0errors1existingwarning. Tested image applied to main preview, no schema or personal-record changes.

## Existing charge edit fix

Edit charge was visible but its authenticated adapter was unavailable and its old handler split charge and linked-expense writes. It now uses one versioned charge.update command with versions captured on opening the form. Standalone charges remain standalone. Included/unresolved financial edits require statement reconciliation again; anchors/snapshots and bank cash remain intact. This does not reconnect charge deletion, repayment editing/deletion or linked refunds. See docs/uk/card-charge-editing.md.

Charge edit verification: all 108 unit/82 PostgreSQL/50 browser tests pass, including standalone edit, linked metadata synchronization, receipt replay and retained stale drafts. Source review found and fixed the unlinked override-payload case; no remaining P1/P2 findings. Build/typecheck passed, lint retains one existing navigation warning.

## Existing repayment edit fix

The visible Edit Payment adapter was unavailable. It now uses one payment.update command with observed payment/card/bank versions, preserving the original payment/statement identity. Bank source corrections restore old outflow and apply new outflow once, without expenses. Card credit/cashback removes funding; no authenticated legacy purchase-refund linker is offered. Included/unresolved amount/date changes require All Debts review; statement anchors/snapshots are retained. No schema or personal-record changes. See docs/uk/card-payment-editing.md. Individual payment deletion and linked refunds remain separate.

Repayment edit verification: all 108 unit/101 PostgreSQL/55 browser tests pass. Browser checks cover funding bank changes, bank-to-credit and credit-to-bank, lost-response replay and stale-bank drafts. Source review found no P1/P2 findings. Build/typecheck passed, lint retains one existing navigation warning.

## User testing pause

The user explicitly requested on 26 November 2026: skip tests until they say otherwise, while continuing to reconnect existing features. Do not run automated unit, integration or browser test suites, or silently resume them in a later continuation. Compile/typecheck/build and source review may continue. New restoration work during this pause must be labelled untested at runtime; earlier passing suites do not verify it.

## Goal contribution restoration

Add Contribution now uses goal.contribute: one recorded GBP transfer and optional fixed allocation updates under the shared owner/manual/receipt transaction. Source/destination cash must cover all fixed earmarks after the transfer. Automatic/null allocations remain automatic, and older primary linked-account goals are supported. Captured versions, pending guards and retained error drafts are in place. No tests were run or added under the user testing pause; compilation and offline build passed. No schema changes or personal-record edits. Inventory: docs/uk/disconnected-actions.md.
