# Initial UK preview verification — 26 November 2026

Scope: synthetic local evaluation of `feature/uk-foundation`, based on upstream `aca1e266ca3610d8f0077191b25563a51b0314cf`. This is not the completed product migration, a real-data release, or a security/compliance certification. No real statements, account records or credentials were used. Existing application runtimes and data were preserved. No push, cloud provisioning or public deployment occurred.

## Executed checks

- Docker frozen pnpm install with `--ignore-scripts`: succeeded, 608 packages reported. No dependency lifecycle scripts were blindly enabled. Dependency registry access is required for installation.
- Full Vitest suite in Docker with network disabled: **18 suites, 87 tests passed**. Includes GBP defaults, London civil dates/DST, reciprocal conversions, explicit cross-currency transfers and debt-payment conservation, alongside retained upstream tests. The initial GBP default regression was observed failing before adaptation.
- `tsc --noEmit --incremental false` in Docker: passed.
- `docker compose -f compose.uk.yml build preview`: production build passed; its Next build step explicitly uses `--network=none`. The production build also typechecks application code.
- `docker compose -f compose.uk.yml run --rm --no-deps browser-test`: initial complete run **6 passed, 4 intentionally skipped**. After moving the preview notice into the main content to prevent sidebar overlap, the final run passed five checks but WebKit reported an internal navigation error opening chat. A focused unchanged-code iPhone rerun passed (one UI journey, one intentionally skipped duplicate policy check); server logs showed no application error. This browser flake remains recorded rather than counted as a clean final full run. Five complete UI journeys use laptop Chromium, iPhone WebKit, narrow Android Chromium, wide foldable-like Chromium and 320px reflow profiles. One server-policy check runs once; the other four copies are intentionally skipped. Viewport emulation is not physical-device certification.
- Exercised overview, accounts, expenses, credit cards, reports and disabled chat routes: GBP visible, no browser runtime errors, no external requests attempted on these paths. Overview has no horizontal document overflow at the tested widths.
- API boundary rejects persistence, authentication, push and AI calls and POST /demo; image optimization and service-worker routes denied. Stock quotes return an explicitly empty offline synthetic result.
- Browser regression first failed against canned upstream AI output; after the change all five layouts show “AI integrations disabled”. No generated analysis or financial advice is claimed. Future UK AI requires verified calculations and explicit privacy/permissions review.
- Startup with `UK_DEMO_ONLY=false`: refused with exit 1, as expected. Both demo flags are mandatory in the evaluation start script.
- External-host fetch from the internal-only application container: unavailable, as expected. Nginx reaches only its configured upstream; it is not a general outbound proxy. Browser CSP additionally limits connections.
- Localhost preview inspected in the in-app browser at http://localhost:13021/demo; synthetic screenshot saved as preview-overview.png.
- `git diff --check`: passed. Original MIT LICENSE has no diff. Origin and upstream main fetched refs matched with zero divergence before local edits.

Reproduce using compose.uk.yml; source is kept in the separate `/Users/daniel/money-dashboard-uk` checkout. Browser tests use the matching official Playwright 1.62.1 image. Unit/type checks use installed frozen dependencies in an isolated Docker test image; no host node_modules install is required.

## Limits and next gates

The saved dependency audit reports **57 advisory records / 51 distinct advisory URLs** (4 low, 22 moderate, 23 high, 8 critical), including runtime and development graphs. No dependency fixes are claimed. Validate primary advisories, update supported dependencies and rerun before real-data use or public deployment. The complete installed graph remains in this disposable image; produce a minimal release artifact later. Vite CJS and stale Browserslist warnings remain.

PIN/database fail-open behaviour, single-owner architecture, push SSRF, session revocation and other source findings remain open in upstream-security-review.md. Local API blocking is an evaluation guard, not remediation of production auth. Demo edits reset on reload. Exact authoritative money, real persistence/tenancy, statement imports, reported-vs-tracked reconciliation, UK debt products and full calendar auditing remain migration work. Non-demo missing-FX fallback must not silently value real records.

No live database, provider, model, market feed or physical device was exercised. No full accessibility or legal review is claimed. Follow product-migration-plan.md for the accepted implementation sequence and release gates.
