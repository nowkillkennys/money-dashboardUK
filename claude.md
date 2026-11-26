# UK Money Dashboard — accepted direction

The user selected https://github.com/nowkillkennys/money-dashboardUK as the application base on26November2026. Retain https://github.com/NightBaRron1412/money-dashboard as upstream and preserve MIT notices. This decision supersedes the old recommendation to evolve Debt Tracker as the main app. Work locally on the feature branch; do not push/publish/provision without authorization.

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
