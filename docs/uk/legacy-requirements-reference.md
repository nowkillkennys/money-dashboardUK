# Historical requirements reference — strategy superseded

Carried from the secure manual implementation through fbf24ee on26November2026. Its feature, correctness, privacy and test requirements persist. Earlier recommendations to keep that app as the primary base are superseded by the user selecting nowkillkennys/money-dashboardUK. Historical relative links refer to the old checkout; current strategy is README.uk.md and product-migration-plan.md. No user financial records are included.

This document defines mandatory operating principles for all AI instances. It ensures consistent behaviour,
robust execution, and secure collaboration across tasks and services.

## Debt Tracker Product Direction

Implementation clarification from the user on 25 November 2026: the intended product aggregates **bank accounts and debts**, with the discontinued Money Dashboard experience as a reference for unified accounts, transactions, budgets and future balance planning, simplified and extended with debt repayment, purchase/BNPL plans and monthly-fee products. This is an experience reference, not permission to use proprietary source or a claim that the current app implements those capabilities. Preserve useful backend work. User approved the phased sequence: secure manual foundation first, PDF statement imports next, full bank connections later; retain browser retrieval including Connect Very as the fourth method, and keep email imports separately authorized.

PDF statements must extract balances, rates, fees, due dates and repayment information where available; assess OCR for scanned documents. Show uncertain/missing fields for confirmation and reconcile before saving; never fabricate missing information. Cost comparisons should show pounds saved, total interest **and fees**, monthly payment effect, payoff time and long-run cost under explicit user-selected assumptions; APR is a rate, not a money saving. Regulatory review gates on personalised prescriptions/referrals remain.

The approved first slice is being implemented on branch `feature/secure-manual-tracking` in `/Users/daniel/debt-tracker-implementation`, isolated from this original running demo database. Its reported-balance/tracked-estimate reconciliation model is the accepted default. The user approved v3 (denser charcoal/warm-white/cobalt/orange) and explicitly authorized continuation into functional visual integration and PDF statement imports. These are implemented in the same isolated feature branch as internal version 1.2.0-dev.1; see `docs/verification/pdf-imports.md`. Bank aggregation, budgets, purchase plans and external connections remain separate follow-on deliveries. See `docs/implementation-status.md` for actual verified progress and remaining gates.

Recorded on 25 November 2026 from the user's voice discussion in “Open Banking App Access” and their request to preserve it in this file.

The goal is to bring lender balances into Debt Tracker automatically where possible, including catalog credit accounts such as Very.co.uk. The user wants the app to log in, retrieve the current account balance, and update the corresponding debt balance. For buy now, pay later purchases, also explore retrieving individual balances and their interest-free expiry dates.

Additional detail supplied by the user from the earlier chat on 25 November 2026: the proposed Very flow is to select **Connect Very** in Debt Tracker, open a browser, let the user log into Very themselves, then read the account balance, credit limit, minimum payment and payment due date and update the corresponding debt record. Explore Playwright for this browser automation, alongside purchase-level BNPL balances and interest-free expiry dates. Preserve user-led authentication rather than collecting the Very password in Debt Tracker. The earlier chat reported finding no publicly documented Very Pay balance API; treat that as a historical observation to recheck, not a verified current limitation. The suggestion that email statement imports could be more reliable also remains to be evaluated.

The discussion considered four complementary ways to obtain data:

- Open banking for accounts supported by an appropriate integration.
- **Proposed open banking provider: Enable Banking.** The user confirmed this name in the voice follow-up on 25 November 2026 as the provider suggested in the earlier “Open Banking App Access” discussion. Evaluate its account/lender coverage, access requirements, pricing and suitability before implementation; no connection or provider integration has been established.
- Browser automation for lender accounts where a suitable API or open banking connection is unavailable, including exploring Very.
- Statement imports, potentially from monthly statements received by email.
- Manual entry where an automatic source is unavailable.

These are planned capabilities to investigate, not verified integrations or completed features. Before implementing browser access, establish feasibility, the lender's access terms, and how authentication and any multi-factor prompts will work. The discussion proposed keeping browser sessions encrypted and local rather than storing lender passwords; session storage and refresh behaviour still need design and validation. Website changes may break browser integrations.

This section preserves product context only; it does not authorize connecting to lender accounts, reading email, or implementing every proposed method without a concrete implementation request.

⸻

## Next Steps and Product Roadmap — 25 November 2026

Source: the user's voice discussion and follow-up requests on 25 November 2026, plus the local functional audit at frontend `http://localhost:13001` and backend `http://localhost:13000`. Recorded by Codex. Status: this audit/roadmap records the starting point; the approved secure manual foundation has since been implemented in the isolated branch, with actual evidence in `docs/verification/manual-tracking.md`. Other roadmap capabilities remain planned. Preserve the earlier product direction and operating instructions. This roadmap does not authorize external lender connections or email access.

The user considers the current UI extremely basic for the intended functionality. It is an initial structure, not an accepted finished design. Future work must address both working behaviour and the richer account, purchase, repayment and integration experience described below.

### Audit Evidence and Limits

- **Runtime verified:** all four pages and sidebar collapse/expand open correctly with empty data. Reloading an internal page returns to Dashboard. Nine lender records load.
- **Runtime verified:** a completed demo debt form closes without creating a record; empty submission gives no required-field feedback. Payment entry has an empty account selector, a numeric Description field and no useful validation feedback when submitting an incomplete negative amount.
- **Runtime verified through focused API tests:** authenticated debt create/read/update/delete works. A £200 test debt was updated to £180. A £25 payment was recorded successfully, but the debt balance remained £180. Negative payment amounts are rejected. A zero-balance debt is incorrectly rejected as missing a required field. These API checks used an internally generated test token; they do not establish that the UI sends authentication correctly or that login works end to end.
- **Runtime verified:** opening Dashboard with that populated debt/payment crashes to a blank screen, with `.toFixed is not a function` in the browser console. API monetary values are strings. Empty-data success does not establish that dashboard calculations work.
- **Runtime verified:** editing the existing 118 118 Money name saves and survives reload. The temporary name was restored, and all original visible form values were compared successfully after reload. The minimum APR at the start of that edit test was 49.8%; the audit did not change rates or fees. General settings are separate: turning both switches off, clicking Save Settings and reloading returns both to on.
- **Runtime verified:** lender required-field validation works. Add Lender fails with generic feedback; backend logs show `POST /api/lenders` returns 404. A DELETE request against a nonexistent lender ID also returns route-not-found; source confirms the DELETE route is absent. Existing lenders were not deleted. Edit-to-Add reuses stale form values.
- **Runtime verified:** Export to CSV produces no download; source confirms it has no action handler. No import control is visible. Interest calculation and savings endpoints return results for tested positive-APR inputs, but 0% APR is rejected as missing, including a 0% balance-transfer savings case.
- **Runtime verified access-control gap:** dashboard summary and recent payments can be read without authentication, and a test payment could be created without authentication. Unauthenticated debt access correctly returns 401. `/api/auth/me` returns a placeholder response with no user. Source shows dashboard queries are not scoped to the signed-in user. Address access control before real financial data is used.
- **Source inspection:** debt/payment lists and submit handlers are placeholders rather than API-backed flows. Calculator components are not mounted in app routes. The monthly-fee calculator incorrectly includes the full balance in its minimum-payment maximum; the savings component's faster-payoff comparison/message is also reversed. These component calculations were not tested through a reachable UI. Scraping scheduling is disabled; the previously discussed retrieval/import capabilities remain plans.
- **Not tested:** successful registration, login/logout during this audit, populated table sorting/pagination, exhaustive calculator correctness, browser/device coverage, or external integrations. API checks rejected missing login fields and invalid registration email. Reset All Data was deliberately not run. Populated dashboard totals could not be validated because rendering crashes.
- **Cleanup verified:** the labelled test debt and its payment were removed through debt deletion and cascading cleanup; database checks found zero remaining rows for that fixture. Failed lender creation left no test lender. The empty dashboard recovered after reload, and switches returned to their initial on state. No application implementation files were changed by the audit.

### Ordered Delivery Plan

Concrete first-slice implementation/test plan: [Secure manual tracking](docs/superpowers/plans/2026-11-25-secure-manual-tracking.md), prepared 25 November 2026 with separate API/security, UI/testing and data/reconciliation planning reviews. Status: execution of the first manual slice was approved and implemented in the isolated branch; `docs/verification/manual-tracking.md` records executed tests and remaining gates. Review the recommended reported-balance/tracked-estimate semantics before implementing payment balance effects. Later subsystems are separate gated plans, not an unbounded rewrite.

Explicit responsive requirement: easy to use in laptop browsers, on iPhones/iOS Safari and Android/standard phones, and narrow/wide foldable or dual-screen-like layouts. The user's phrase “iPhone duo” does not identify a specific model. Test orientation changes, zoom/reflow, touch and keyboard, safe areas, readable currencies/tables/forms and narrow navigation from the first UI slice. The linked plan contains viewport and physical-device evidence requirements; browser emulation does not establish real-device compatibility.

1. **Reliable manual tracking first.** Fix money serialization/parsing and the populated dashboard crash. Wire the debt and payment screens to authenticated APIs, including loading, validation, errors, create/read/update/delete and reload persistence. Complete missing payment operations. Scope financial data and mutations to the authenticated owner. Verify account totals and monthly payment totals using populated examples, dates and more than the recent-payment limit; the current monthly figure sums the recent list rather than a dedicated month total. Completion requires an end-to-end manual debt/payment journey that survives reload and renders correct dashboard totals.
2. **Define balance reconciliation before automatic updates.** Decide whether a payment changes the tracked balance immediately, how interest/fees and adjustments enter the ledger, and how an imported lender snapshot reconciles with payments already recorded. Store source, effective date and sync/import identity as appropriate. Repeated imports must not duplicate payments or subtract them twice. The unchanged balance observed in the API test is current behaviour, not an approved reconciliation design.
3. **Finish supporting features.** Implement lender add/delete and reliable form reset; retain working lender edit. Persist general settings, implement CSV export, and provide useful error feedback. Expose calculators through navigation only after correcting their formulas, zero-value handling and payoff messages, with verified examples. Distinguish the 118 118 Simple Monthly Fee product from the generic 118 118 Money credit-card record; validate applicable terms rather than treating the existing rate range as that product's agreement.
4. **Design a substantially more capable UI.** Agree account detail screens, balances and history, transactions/purchases, BNPL repayment plans, interest-free expiry dates, upcoming payments and integration controls. Show the origin and freshness of balances and actionable sync/validation errors. The current tables and modals may provide structure, but do not imply acceptance of their basic design or functionality.
5. **Add separate retrieval modules after the foundations.** Investigate open banking, lender browser retrieval and statement imports independently. Each module needs saved on/off settings, connection and sync status, last successful update, manual refresh and clear failure/re-authentication paths. Retain manual entry. Validate provider/lender coverage, session security and MFA behaviour before connecting accounts. Very purchase-level balances and expiry dates remain a specific feasibility goal; email statement access requires a separate concrete request.
6. **Verify each stage with focused integration and end-to-end checks.** Run tests in Docker, cover populated and empty data, persistence, access boundaries, date/month calculations, zero APR, failed requests, reconciliation and repeat imports. Exercise cleanup and recovery paths. Broader device/accessibility checks should accompany the UI redesign. Do not label features complete solely because their components or API endpoints exist.

### Frasers Plus Account Model — Proposal to Validate

The user notes that Frasers Plus can be used at multiple locations. Proposed design: represent one lender account and its account-level balance, with purchases tagged by shop/location and separate repayment plans when their terms differ. Do not create a duplicate account balance for each shop. Validate statement structure, purchase allocation, repayment terms and available integration data with the user before implementation. This is a design proposal, not a verified lender integration or finalized schema.

### Current State Versus Target and UI Proposal — 25 November 2026

Status: reviewable proposal prepared by Codex from the updated product direction, audited runtime behaviour and current source. It is not an approved implementation specification. No external provider capability is assumed verified. The existing basic UI is not the user's accepted final design.

**Assessment:** the app is relevant as an early technical foundation: it already models lenders, user-owned debts, payments and interest history, and has working debt API operations and lender editing. It does not yet represent the intended product end to end. There are no purchase, repayment-plan, balance-snapshot, import-batch, connection or persisted module-setting entities in the current table definitions. Four navigation pages cannot currently expose the necessary detail. Dashboard failure with populated data and missing UI persistence are functional blockers, not styling issues. The frontend test command currently only prints `No tests yet`; it does not establish test coverage.

**Approaches considered:** (a) repair and restyle the existing four screens: fastest initial change, but leaves purchase/plan detail and integration management poorly represented; (b) evolve the existing stack into an account-focused application: recommended, preserving useful code while adding the domain structure and screens required; (c) replace the entire frontend/backend: higher migration and regression cost without evidence that a different framework solves the identified problems.

**Proposed information architecture:**

| Destination | Main purpose and content |
| --- | --- |
| Overview | Total outstanding balance; amount due in the next 30 days; recorded payments this calendar month; upcoming due dates; interest-free periods ending soon; accounts needing attention. Each amount must have a defined time period and data source. Empty, loading, stale and failed data are distinct states. |
| Accounts | Search/filter by lender, account type and status. Show account name, outstanding balance, minimum payment, due date and source/last checked time. Primary action: Add account; each row opens its details. |
| Account details | Persistent header with balance, available/total credit where known, minimum payment, due date and freshness. Tabs: Summary, Purchases & plans, Payments & adjustments, Balance history, Connection. Actions: Record payment, Add purchase, Update balance and Edit account. Only show applicable fields and available actions for that account type. |
| Repayments | A chronological schedule of payments due and interest-free expiries across accounts, with account/purchase context. Distinguish contractual instalments, minimum payments and user-planned payments; do not add overlapping obligations twice. A recorded payment is a tracking entry, not a bank transfer. |
| Connections & imports | Independently enabled Open Banking, browser retrieval and statement modules; per-account source, connection/sync state, last attempt/success and manual refresh. Statement file import has a preview and reconciliation step. Email import is a separately authorized future connection. |
| Calculators | Reachable interest comparison and monthly-fee scenarios, with editable assumptions, costs and payoff schedules. Separate fee-based products from APR-based products. Results remain hypothetical until an explicit account edit is saved. |
| Settings | Persisted preferences/module controls, lender and product catalogue management, data export and account/session controls. Keep destructive maintenance away from routine account actions. |

**Visual direction:** a calm, light financial workspace with a compact sidebar, clear page titles, consistent action placement, generous space around account summaries and denser tables for transactions. Use dark ink, restrained blue/teal accents, tabular currency figures, and explicit text alongside status colours. Reserve amber for approaching due/expiry dates and red for overdue/error states. Replace the duplicated app headings and large empty fixed-height panels with useful account summaries and next actions. On narrow screens, stack summaries, use account cards and preserve labelled actions; avoid relying on hover, colour alone or wide tables. Reuse Ant Design accessible primitives with explicit labels, keyboard focus and inline validation; this is not acceptance of the library's unmodified default appearance.

**Primary flows:**

- Manual account: Add account → select lender and specific product → enter balance/as-of date and applicable terms → review → save → account detail. A £250-limit/£8-fee 118 118 product uses fee terms, not the generic lender's APR range. Treat those figures as the user's supplied example pending agreement validation.
- Payment: choose account → enter amount/date/description → preview the effect on the tracked balance → save → show updated history and totals → allow correction/removal with the reconciliation consequences explained. The balance policy must be agreed before implementing this flow.
- Purchase/BNPL: select account → enter purchase, shop, amount and applicable plan → record instalments and/or interest-free expiry → review schedule. Frasers Plus remains one account across shops; shop-tagged purchases and separate plans are the proposal to validate. Account balance remains authoritative and is not summed again with its component purchases.
- Proposed Connect Very: select the browser module and account → explain which fields will be read → open user-led browser login/MFA → retrieve supported fields → preview balance, limit, minimum payment and due date, plus purchase/expiry details only if technically available → reconcile → save. No password field in Debt Tracker. Show unsupported/unknown data explicitly; never imply that a connection or read succeeded merely because a browser opened. Encrypted local session storage remains a design/security requirement to validate against the eventual deployment model.
- Statement import: select file → parse into a preview → flag unknown fields and potential duplicates → map to account/purchases → reconcile snapshot and transactions → confirm import. Store import identity to prevent repeat imports from duplicating records. Enable Banking is the proposed Open Banking provider only; coverage, access and pricing require separate verification before any implementation promise.

**Data and API implications:** distinguish lender from product/terms and account; extend the current debt model or migrate it to accounts without duplicating balances. Add account purchases with optional shop tags; plans with instalments/expiry dates and validated allocation rules; a ledger of payments, fees, interest and adjustments; dated balance snapshots with source; import batches and deduplication identifiers; account connections with status/last sync; and persisted user/module preferences. These are logical responsibilities, not a final table-per-item prescription. Use integer minor units or a consistently parsed decimal representation, explicit calendar dates/timezones, and nullable unknown values instead of invented zeros. All account-related reads/writes need authenticated owner scoping, including dashboard, payments, snapshots and imports. Shared lender catalogue mutation needs an explicit authorization policy. Add paginated history and aggregate endpoints so monthly totals do not depend on the first five recent records. Use version/conflict checks or equivalent safeguards for concurrent manual and sync updates. Preserve source/as-of metadata and reconcile snapshots against the ledger to avoid subtracting the same payment twice.

**Delivery slices:** first establish access boundaries, money handling and a reliable manual account/payment vertical slice with populated-dashboard tests. Next deliver account detail and reconciliation rules, then purchase/repayment-plan modelling and expiry views. Complete lender CRUD, settings, export and calculator correctness alongside those flows. Build the redesigned screens incrementally against real APIs; do not ship inert controls presented as working features. Investigate and add retrieval modules individually only after their feasibility and authentication/storage design are established. Future work must include authenticated end-to-end persistence, owner-isolation, zero APR/zero balance, monthly totals, expiry dates, duplicate imports and failed-sync recovery checks.

### Parallel Review Refinements — 25 November 2026

At the user's explicit request, separate read-only agents reviewed UI/flows, backend/data/security and integration boundaries. Codex coordinates this document; no implementation changes or new external connections were made.

- **First design slice:** review three connected screens: attention-led Overview, Accounts, and a populated Account detail, with manual account/payment forms. Then review purchase/BNPL detail and balance reconciliation. Start visible navigation with Overview, Accounts, Repayments and Settings. Expose calculators from relevant account contexts/Settings initially; add a dedicated Connections & imports destination when working modules justify it. The broader information architecture above describes the eventual product, not a requirement to ship empty destinations.
- **Daily use and first run:** lead Overview with overdue items, next due dates, expiring interest-free periods and failed updates, alongside total balance. An empty account list should guide directly to Add account. Permit Other lender/custom product and unknown optional terms, so manual entry never depends on a provider or catalogue match. Account and tab URLs must survive refresh and match navigation selection.
- **Repayment and purchase details:** distinguish Upcoming from Recorded activity. Label minimum due, plan instalment and planned extra payment separately. Treat an interest-free expiry as an event, not automatically an additional payment obligation. A purchase detail shows shop, purchase date, original/remaining amount, terms, next instalment, expiry and allocations; do not infer deferred-interest rules merely from an expiry date.
- **Reconciliation review:** show old and incoming balance, each as-of date/source, intervening recorded activity and unexplained difference. Preview the proposed change before saving and preserve a history entry. This interaction is a prerequisite for trustworthy automatic updates.
- **Additional source-based security findings:** `databaseService.ts` builds lender/debt UPDATE column names from request-body keys without a runtime allowlist. Ownership is checked before debt update but not included in its SQL mutation predicate. Require schemas/allowed fields and owner scoping in the mutation itself; TypeScript interfaces do not validate incoming JSON. Auth code also contains a known fallback JWT secret: require valid configured secret material rather than accepting that fallback. These are source-inspection findings, not penetration-test results.
- **Integration reality:** `index.ts` mounts no scraping router; the scheduler only logs that it is disabled; the unused scraping controller's run handler records success without retrieving lender data. Do not present this as a working connector. Future connectors need explicit states such as disabled, not connected, awaiting login/MFA, ready, updating, needs attention and unsupported, with last attempt/success and field-level availability. A successful browser launch or placeholder log is not a successful sync.
- **Design acceptance examples:** show populated, empty, loading, stale, failed and unsupported-data states, plus a narrow-screen purchase/repayment view. Success messaging must follow confirmed persistence. Reuse UI primitives while replacing the current screen composition; a visual reskin alone does not close the functional gaps.

- **Sequence clarification:** agree payment/balance reconciliation within the first manual tracking slice, before calling that slice reliable. Example: £180 starting balance, a £25 recorded payment, then a £155 lender snapshot must result in £155, including after repeat import. Distinguish lender-reported balance from an estimate based on newer activity, and support correction/reversal and incomplete purchase allocations. Commit related history/balance changes atomically.
- **Module behaviour and deployment:** enabling a method does not connect an account; disabling stops new reads but preserves history; disconnect/revoke is a separate action. Keep connection state, sync-attempt state and data freshness separate. Adapters produce candidate dated observations for the shared preview/reconciliation pipeline instead of overwriting balances directly. Establish whether user login occurs in a local browser or a hosted/container browser before promising encrypted local session storage; they are different deployments. The current lender list is a catalogue, not evidence of connected-account support.
- **Migration and calculator gates:** source review found startup schema creation alongside migration files with differing owner/deletion constraints. Inspect the installed schema and select a single migration authority consistent with project Sqitch requirements, including handling any legacy ownerless rows. Record account-specific terms/effective dates and unallocated balances where purchase details are incomplete. The interest controller does not forward monthly-fee input to its calculation service, and payoff scenarios need an explicit non-repaying result rather than an arbitrary iteration limit. Validate fee charging rules and plan allocations before exposing confident payoff claims.

### Personal-First Scope, Compliance and Cost-Reduction Planning — 25 November 2026

Explicit user requirements: personal use now, with registration and use by other people intended later; design FCA considerations, UK data protection and security in from the start; plan helpful ways to reduce costs. This section is documentation/planning only. It does not authorize deployment, implementation or external connections, and does not establish FCA approval, regulatory compliance or a completed legal assessment.

**Regulatory perimeter and operating model:** before any public pilot, record the operator, target users/jurisdictions, business model and exact feature journeys, and obtain a competent perimeter assessment. Distinguish tracking, factual information and user-controlled calculations from advice on a particular person's debts or repayment choices: personalised online advice can fall within debt counselling ([FCA PERG 17](https://www.handbook.fca.org.uk/handbook/PERG/17.pdf)). Do not assume a calculator is outside the perimeter because it uses that label. If refinancing links, lender introductions, commissions or product referrals are introduced, assess credit broking and financial-promotion implications ([FCA credit brokers guide](https://www.fca.org.uk/firms/regulatory-guide-credit-brokers)). Establish the required permissions or valid operating arrangement before enabling in-scope activity. Assess Consumer Duty applicability against the actual activities and operating model; do not assert it applies to every tracker ([FCA scope rules](https://handbook.fca.org.uk/handbook/prin3/prin3s2)). Disclaimers alone do not settle the perimeter or replace permissions.

**Open Banking:** verify who legally provides account information services, the relevant FCA registration/authorization and permitted activities, contractual responsibilities, consent/revocation flows and actual account/data coverage ([FCA account information services](https://www.fca.org.uk/consumers/account-information-payment-initiation-services)). Enable Banking remains a proposed provider: its coverage, pricing, eligibility and ability to support this app's operating model have not been verified. Do not assume another firm's permissions automatically extend to Debt Tracker. Keep Open Banking service consent distinct from the documented UK GDPR lawful basis for each processing purpose; data-sharing permission does not necessarily constitute GDPR consent ([ICO lawful bases and data-sharing permissions](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/smart-data-schemes-and-data-protection/lawful-bases-and-data-sharing-permissions/)).

**Privacy by design now:** map data and purposes across manual entry, snapshots, transactions, statements, sessions, logs and backups; identify controller/processor roles and recipients. Record justified lawful bases, collection notices, necessary fields and privacy-protective defaults. Screen for a DPIA and complete one where processing is likely to create high risk; document the decision ([ICO data protection by design](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default)). Before accepting other users, implement access/rectification requests, export/portability where applicable, and deletion/restriction/objection handling with exceptions and identity checks as relevant ([ICO access and related rights guidance](https://ico.org.uk/media2/migrated/4031029/right-of-access-1-0-20240919.pdf)). Define justified retention periods and deletion behaviour for source files, sessions, history and backups rather than retaining everything indefinitely ([ICO storage limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/)).

Record hosting/subprocessors, required processor contracts and instructions ([ICO contracts](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/contracts/)); assess any restricted international transfers and applicable safeguards ([ICO transfers guide](https://ico.org.uk/for-organisations/uk-gdPR-guidance-and-resources/international-transfers/a-guide-to-international-transfers/)). Maintain a proportionate incident process with named responsibility, containment, investigation, records and notification assessment. A notifiable breach must be reported without undue delay and within 72 hours of awareness; high-risk affected individuals must also be informed without undue delay ([ICO breach guidance](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide/)). Do not treat every incident as automatically notifiable. Recheck applicable legislation and guidance at the launch review rather than freezing this dated assessment.

**Security implementation priorities:** close the audited unauthenticated dashboard/payment paths and scope all reads and mutations to authenticated owners. Reject unexpected fields and owner reassignment; configure secrets without known fallbacks. Test user A against user B's records. Define session expiry/revocation, least-privilege service access, encrypted session/secret storage with separate key management, and transport protection for the chosen deployment. Do not collect lender passwords. Audit relevant access/change/sync events without tokens, cookies, passwords or unnecessary financial payloads. Include dependency/security checks, recoverable encrypted backups and a demonstrated restore. These are proportionate engineering requirements and evidence to collect, not a compliance certification.

**Ways to reduce costs — proposed feature:** let the user select what-if scenarios such as an extra repayment, different monthly-fee assumptions, or paying a purchase before its interest-free expiry. Display baseline versus scenario, total cost/payoff changes, source and as-of date, assumptions, unknown charges and uncertainty. Never promise savings when terms or data are incomplete; do not assume an expiry reveals deferred-interest rules. Show the user's chosen scenarios without an automated prescriptive repayment ranking. Personalised recommendations such as “pay this debt first”, refinancing/product recommendations and referral journeys remain gated on the perimeter assessment and any required permissions; user-selected scenarios also require review before public release. Calculator correctness, understandable results and clear correction paths are prerequisites.

**Proportionate gates and evidence:**

1. Personal manual release: security fixes; populated-data/calculator/reconciliation tests; minimal data map, secret/session design and backup-restore evidence. No public registration launch implied by an existing Register page.
2. Any real retrieval module: field/coverage feasibility, provider/lender terms and operating-model checks, privacy information and lawful-basis record, DPIA screening, consent/session lifecycle, owner-isolation and duplicate-import tests. Email access remains separately authorized.
3. Public pilot: documented perimeter/permissions decision, operator and provider responsibilities, reviewed customer journeys/notices, applicable Consumer Duty assessment, retention/rights workflows, contracts/transfer assessment, incident response and security/restore test evidence. Resolve material gaps before accepting other users' financial data.

Outstanding decisions: operator/legal and monetisation model; permitted launch jurisdictions; hosting and key custody; exact personalised-suggestion scope; provider contractual/permission arrangement; retention periods and whether the proposed processing requires a DPIA. Personal-first and future multi-user intent are already confirmed and need not be asked again.

### Wider UK Applicability Register — Checked 25 November 2026

This extends the compliance planning above. **Mandatory when applicable** means an obligation depends on the actual activity and legal scope; **conditional/future** is a launch or feature trigger; **good practice** is a chosen engineering standard rather than a claimed legal certification. A local personal demo need not implement every public-business process now. Preserve the ability to meet future obligations and block public/paid launch pending review. The project owner is accountable for maintaining this register and assigning an implementation owner and qualified legal/privacy reviewer before public launch; no adviser, DPO or regulator appointment has been made by this document.

| Area and body | Applicability and planned evidence |
| --- | --- |
| UK data protection; UK information-rights regulator | **Mandatory when within scope:** assess UK GDPR and Data Protection Act 2018 as amended, not an unamended GDPR checklist. DUAA is staged: most remaining data-protection provisions commenced 5 February 2026; the regulator transition took effect 30 September 2026 ([government commencement record](https://www.gov.uk/guidance/data-use-and-access-act-2025-plans-for-commencement)). Retain familiar ICO source links while checking current regulator identity/contact details at launch. Include an accessible data-protection complaints process; current [regulator complaints guidance](https://ico.org.uk/for-the-public/how-to-make-a-data-protection-complaint) supplements rights and breach handling. Do not assume every DUAA provision commenced on Royal Assent. Assess any personal/household exemption on actual use; future operation for other users is a separate assessment. |
| PECR: storage/access technologies | **Conditional on actual technologies:** inventory cookies, local/session storage, pixels and device access by purpose, including authentication. Determine applicable consent or exemption requirements and transparency; do not assume “no cookies” means PECR cannot apply, or that every storage purpose needs the same banner. Avoid adding optional tracking by default. Use [ICO storage/access guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/), updated for DUAA. |
| PECR: future email/SMS marketing | **Conditional if marketing is introduced:** distinguish service messages from promotional content, record permission/withdrawal and suppression, and verify any soft-opt-in conditions instead of assuming signup permits marketing. See [ICO marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/plan-direct-marketing/). Importing a statement is not permission to send marketing. |
| Data protection fee | **Assessment required for operating model:** use the [ICO fee self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/) and retain the decision. Do not claim a fee, exemption or registration is automatic, or that paying proves compliance. |
| Consumer protection; CMA/Trading Standards and courts | **Conditional on trader-to-consumer activity:** assess misleading claims/omissions, pressure, pricing and unfair terms, including savings and “connected lender” claims. DMCC unfair-commercial-practice provisions apply to practices from 6 April 2025 ([CMA guidance](https://www.gov.uk/government/publications/unfair-commercial-practices-cma207/unfair-commercial-practices)); they are not deferred merely because subscriptions have separate commencement. If selling the service, review Consumer Rights Act 2015 obligations and Consumer Contracts Regulations applicability/exclusions, pre-contract information, cancellation/refund rights and durable confirmation ([government distance-selling guidance](https://www.gov.uk/online-and-distance-selling-for-businesses)). |
| Subscriptions, if charged later | **Future/commencement-sensitive:** design clear pricing, renewal and easy cancellation, but verify the final DMCC subscription regulations and transitional scope before taking subscriptions. The [April government response](https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime/outcome/government-response-to-consultation-on-the-implementation-of-the-new-subscription-contracts-regime-web-accessible-version) anticipated spring 2027; a newer [23 November Parliamentary daily report](https://qna.files.parliament.uk/qnadailyreports/Written-Questions-Answers-Statements-Daily-Report-Commons-2026-11-23.pdf) states 1 January 2027 subject to Parliamentary approval. The latter was identified in indexed primary-source text; full PDF retrieval failed during this review. Treat the effective date as requiring final instrument verification, not as a rule already in force on this audit date. |
| Accessibility; equality law/EHRC | **Mandatory when providing an in-scope service:** assess reasonable adjustments under Equality Act 2010 in Great Britain and relevant Northern Ireland disability law. Public-sector website regulations are not automatically this private app's regime ([government accessibility explanation](https://www.gov.uk/guidance/accessibility-requirements-for-public-sector-websites-and-apps)). **Good-practice evidence:** target [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/), keyboard/screen-reader usability, zoom/reflow, clear errors and accessible authentication. WCAG conformance is not itself a universal statutory certification or a substitute for considering adjustments. |
| Business/website disclosures | **Conditional on operating/trading form:** identify legal operator, contact details and required online-service/trading information; for a limited company include the required company particulars ([Companies House/government disclosures](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material)). Verify entity-specific tax/VAT and contract disclosures if trading, rather than inventing them for the personal demo. |
| Payment services and card security | **Conditional on future functionality:** recording a payment is not initiating one. If bank payment initiation, holding/transferring funds or similar activity is added, reassess permissions, consent, security and incident duties before enabling it ([FCA third-party payment providers](https://www.fca.org.uk/firms/account-information-services-payment-initiation-services)). No payment initiation is currently planned for implementation here. Do not assume PCI DSS scope merely from storing debt balances; determine actual card-data/payment handling and contractual scope if card billing is introduced. |

**Security/reporting scope:** maintain the existing UK GDPR breach assessment and assess additional FCA/payment-service incident reporting only if the final regulated role triggers it. Review any other sector-specific cyber duties against the actual entity and service; do not assume a debt tracker automatically falls under every cyber regime. Threat modelling, owner-isolation tests, dependency scanning and restore exercises are proportionate assurance evidence, not invented regulator approvals or universal requirements to buy certifications.

**Launch review record:** before public registration or paid launch, the project owner must record each row as applies/does not apply/needs advice, its trigger and rationale, current source/commencement date, responsible person, required action and evidence. Obtain appropriate legal/privacy review of unresolved perimeter, consumer-contract and transfer questions; test the resulting rights, complaints, accessibility, security and cancellation journeys where applicable. Repeat the assessment when adding referrals, personalised recommendations, marketing, payments, new countries or new data processors. Do not reopen the already-confirmed personal-first/future multi-user decision.

## Environment & Subscription

**Claude Subscription:** Claude Pro Plan
- Higher context window for complex tasks
- Extended conversation capabilities
- Priority access during peak times
- Enhanced performance for multi-agent workflows

⸻

token reduction: alias=CLAUDE|override=CLAUDE|sig=1|pipe_name=lock_fn_route_file|port=locked|pipe_structural_diff=enabled|pipe_diff_format=md|code=errors+docstrings+prechecks+timeouts+filechecks|docs=sync+headings+realcode+purpose+usage+params+defs+pipe_only_md|tasks=clear+assigned+atomic+no_bypass+review+update+deps+escalate|security=no_secrets+validate+no_eval+least_priv+log_no_data+perm_check|exec=log_severity+error_msg+resource_limit+progress+backoff|principles=no_mock+test_errors+evidence_only+validate+traceable|design=KISS+YAGNI+SOLID_CORE|ext=match_struct+test_utils+manifest_ver+compat+perf_check|qa=review+proofread+clear_msg+fix_guidance+rollback|test=unit+integration+mark_data+CI+coverage85+regression+testlogs|change=manifest+log_who+ver_bump+rollback+audit

_____

Code Quality Standards

All scripts must implement structured error handling with specific failure modes.
Every function must include a concise, purpose-driven docstring.
Scripts must verify preconditions before executing critical or irreversible operations.
Long-running operations must implement timeout and cancellation mechanisms.
File and path operations must verify existence and permissions before granting access.
⸻

Documentation Protocols

Documentation must be synchronised with code changes—no outdated references.
Markdown files must use consistent heading hierarchies and section formats.
Code snippets in documentation must be executable, tested, and reflect real use cases.
Each doc must clearly outline: purpose, usage, parameters, and examples.
Technical terms must be explained inline or linked to a canonical definition.
⸻

Task Management Rules

Tasks must be clear, specific, and actionable—avoid ambiguity.
Every task must be assigned a responsible agent, explicitly tagged.
Complex tasks must be broken into atomic, trackable subtasks.
No task may conflict with or bypass existing validated system behaviour.
Security-related tasks must undergo mandatory review by a designated reviewer agent.
Agents must update task status and outcomes in the shared task file.
Dependencies between tasks must be explicitly declared.
Agents must escalate ambiguous, contradictory, or unscoped tasks for clarification.
⸻

Security Compliance Guidelines

Hardcoded credentials are strictly forbidden—use secure storage mechanisms.
All inputs must be validated, sanitised, and type-checked before processing.
Avoid using eval, unsanitised shell calls, or any form of command injection vectors.
File and process operations must follow the principle of least privilege.
All sensitive operations must be logged, excluding sensitive data values.
Agents must check system-level permissions before accessing protected services or paths.
⸻

Process Execution Requirements

Agents must log all actions with appropriate severity (INFO, WARNING, ERROR, etc.).
Any failed task must include a clear, human-readable error report.
Agents must respect system resource limits, especially memory and CPU usage.
Long-running tasks must expose progress indicators or checkpoints.
Retry logic must include exponential backoff and failure limits.
⸻

Core Operational Principles

Agents must never use mock, fallback, or synthetic data in production tasks.
Error handling logic must be designed using test-first principles.
Agents must always act based on verifiable evidence, not assumptions.
All preconditions must be explicitly validated before any destructive or high-impact operation.
All decisions must be traceable to logs, data, or configuration files.
⸻

Design Philosophy Principles

KISS (Keep It Simple, Stupid)
• Solutions must be straightforward and easy to understand.
• Avoid over-engineering or unnecessary abstraction.
• Prioritise code readability and maintainability.

YAGNI (You Aren’t Gonna Need It)
• Do not add speculative features or future-proofing unless explicitly required.
• Focus only on immediate requirements and deliverables.
• Minimise code bloat and long-term technical debt.

SOLID Principles

Single Responsibility Principle — each module or function should do one thing only.
Open-Closed Principle — software entities should be open for extension but closed for modification.
Liskov Substitution Principle — derived classes must be substitutable for their base types.
Interface Segregation Principle — prefer many specific interfaces over one general-purpose interface.
Dependency Inversion Principle — depend on abstractions, not concrete implementations.
⸻

System Extension Guidelines

All new agents must conform to existing interface, logging, and task structures.
Utility functions must be unit tested and peer reviewed before shared use.
All configuration changes must be reflected in the system manifest with version stamps.
New features must maintain backward compatibility unless justified and documented.
All changes must include a performance impact assessment.
⸻

Quality Assurance Procedures

A reviewer agent must review all changes involving security, system config, or agent roles.
Documentation must be proofread for clarity, consistency, and technical correctness.
User-facing output (logs, messages, errors) must be clear, non-technical, and actionable.
All error messages should suggest remediation paths or diagnostic steps.
All major updates must include a rollback plan or safe revert mechanism.
⸻

Testing & Simulation Rules

All new logic must include unit and integration tests.
Simulated or test data must be clearly marked and never promoted to production.
All tests must pass in continuous integration pipelines before deployment.
Code coverage should exceed defined thresholds (e.g. 85%).
Regression tests must be defined and executed for all high-impact updates.
Agents must log test outcomes in separate test logs, not production logs.
⸻

Change Tracking & Governance

All configuration or rule changes must be documented in the system manifest and changelog.
Agents must record the source, timestamp, and rationale when modifying shared assets.
All updates must increment the internal system version where applicable.
A rollback or undo plan must be defined for every major change.
Audit trails must be preserved for all task-modifying operations.


- Use KISS and DRY principals
- Follow SOLID Principles
- Follow YAGNI (You Aren't Gonna Need It)
- Use git to track changes and commit after each chunk of work
- Use agents for performing concurrent tasks using git worktree
- Write tests for a feature BEFORE developing the feature
- All actions should be performed in containers
- Destructure imports when possible (e.g. `from bar import foo` or import { foo } from 'bar')
- Prefer running single tests, and not the whole test suite, for performance
- Generate cluade.md files in major sub directories
- Ask questions about requests when required to create a better task plan
- Plan for multiple concurrent agents where possible
- Take responsibility for code quality
- Proactively identify issues and solutions
- Engage in constructive dialogue
- Question whether your actions are scope creep, if they are a good idea but not immediateley required, document them but do not implement
- Focusing on immediate needs
- DO NOT Add "just in case" features
- New features should be feature flagged so they can be enabled and disabled by platform settings
- Use sqitch for database change tracking
- All testing should happen in docker
- Use pipenv if you need to run python locally outside of a container
- Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.
