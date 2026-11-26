# UK Money Dashboard — accepted direction

The user selected https://github.com/nowkillkennys/money-dashboardUK as the application base on 26 November 2026. Retain https://github.com/NightBaRron1412/money-dashboard as upstream and preserve MIT notices. This decision supersedes the old recommendation to evolve Debt Tracker as the main app. GitHub API verification on 26 November 2026 confirms this repository is still a fork of the original upstream. The user explicitly authorized updating this guidance and pushing the completed work to `origin/feature/uk-foundation`. This authorization does not include merging to main, public deployment or provisioning services.

## Approved continuation — 26 November 2026

The user reviewed the UK demo and approved the base/interface and continuation: authentication, per-user isolation and dependency remediation first, followed by tested debt reconciliation and PDF imports. Preserve the approved interface; do not reopen aesthetics. Credit Cards remains a card-specific view within a broader debt grouping. The new authenticated local foundation is separate from the synthetic demo and from the former apps. No real records are migrated automatically.

Current absolute session lifetime is eight hours with server-side revocation. The user proposed easy return after idle with a PIN. Idle/PIN unlock is not implemented: design a server-enforced lock/re-authentication state separately, never a client-only cover or the old household PIN. No external AI credentials or configuration is authorized.

## Main-app integration requirement

The user explicitly reaffirmed adapting the original integrated MAIN APP/routes and schema. The standalone workspace is intermediate only. Keep the original feature-rich shell, existing account/transaction/card/goal/allocation/subscription/holding/dividend/reconciliation/snapshot/notification implementations and relationships. Connect them to server-derived ownership and transactional financial commands. Do not call the entire original app a demo or rebuild a separate debt product. No duplicate financial authorities: shared card identity, linked expenses, bank-funded repayments and statement anchors must stay consistent. See docs/uk/main-app-integration.md for the current vertical slice and unported adapters.

## Current delivered integration and evidence

The authenticated main app runs locally at http://127.0.0.1:13022/ using the approved original shell. `/workspace` redirects to `/debts`. The existing username and password remain unchanged; never place credentials in source, documentation or logs. The synthetic demo and former apps remain separate, with their real-data databases untouched.

Overview, accounts, income, expenses, credit cards and reports read the original-shaped per-user ledger. Native bank/card/transaction commands, shared card identities, linked purchase expenses and atomic bank-funded repayments use one financial authority. All Debts and PDF review reconcile against the same anchors and payment/charge history. PDF extraction produces typed observations for explicit review; it does not silently replace balances or retain full card numbers/names. Repeat imports and command retries are protected against duplicate effects.

Goals/allocations, subscriptions and holdings/dividend WRITE adapters remain unported and explicitly reject mutations. Their useful original implementation and schema relationships are preserved. Correction/refund flows, broader duplicate reconciliation and automatic snapshots also remain work; do not describe this slice as a complete migration.

Verified candidate evidence: 106 unit tests across 22 files, 26 PostgreSQL tests across seven files, and 15 browser journeys across five layouts passed. ESLint, TypeScript and an offline production build passed. The final main-only rerun encountered one internal iPhone WebKit navigation error; the unchanged focused rerun passed. Record this flake and the limits of emulation honestly. This guidance-only update reuses that evidence and requires whitespace/diff review, not a redundant full suite. Details: docs/uk/main-app-integration.md and docs/uk/main-app-integration-review.md.

## Repository publication status

The user authorized the feature-branch push on 26 November 2026. Publish completed local commits plus this guidance update to `origin/feature/uk-foundation` without force-pushing; verify the remote head against local HEAD and report the resulting commit. No merge to main or deployment is authorized. Keep the upstream remote and MIT LICENSE/notices intact. `.uk-work`, credentials, environment files, real statements/extracted text and generated test artifacts must stay excluded. Committed fixtures and the verification screenshot are synthetic.

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
