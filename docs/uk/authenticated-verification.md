# Authenticated foundation — executed verification, 26 November 2026

This evidence covers the local synthetic foundation in feature/uk-foundation. No real statement, financial record, old database or external account was used. No cloud/model setup, remote push or public deployment occurred. Original MIT LICENSE remains unchanged.

## Checks

- Frozen dependency installation in Docker with lifecycle scripts disabled; network-disabled Next production builds passed for both demo and authenticated modes (Next 16.4.6 / React 19.3.1).
- Final network-disabled Vitest suite: **101 tests / 21 files passed**. Includes retained upstream tests, GBP/date/FX invariants, exact debt money, typed parser observations and auth/cookie/origin/default-mode guards.
- Final isolated PostgreSQL suite: **17 tests / 4 files passed** against the separately initialized db-test volume. Tests cover two identities, hashed/revoked/expired/disabled sessions, concurrent login limits, least-privilege roles, forced RLS, forged ownership/foreign keys, cleared pooled context, rollback, concurrent idempotency/stale versions, pending preservation, append-only snapshots and owner/expired/duplicate PDF confirmation. No resets or truncates are used; tests clean their own synthetic rows.
- ESLint: **zero errors/warnings**. TypeScript no-emit: passed. Production builds also typecheck the route/UI code.
- JavaScript dependency audit: **zero findings across all severities**, down from 57 reported records. Saved output: ignored .uk-work/workspace-final-audit.json. This is not an OS/image audit or proof that application code has no vulnerabilities.
- Original synthetic demo: **6 browser checks passed, 4 deliberate duplicate-policy skips**, across five profiles. GBP and no-external-request/error checks passed; integrations, writes, image processing and service worker denial remain in place after the dependency upgrade.
- Final authenticated browser suite: **10 checks passed** across laptop Chromium, iPhone WebKit, narrow Android Chromium, wide foldable-like Chromium and 320px reflow. This includes both lost-response and committed-then-503 regressions on every profile. Browser emulation is not physical-device certification.
- Authenticated browser journeys use a separate internal browser-workspace service whose exact configured origin matches the test browser, and a separate db-test database. The actual loopback workspace retains only its configured 127.0.0.1 origin. No Origin checks are disabled for testing.
- Browser journeys cover sign-in, create a card debt, posted payment, reload/session persistence, explicit statement inclusion, synthetic PDF upload/confirmation, persisted PDF snapshot, input switches, logout, unauthenticated API denial, wrong-origin rejection and legacy route denial. Every exercised request remains local; no page runtime errors or horizontal document overflow in the tested layouts.
- Lost-response testing commits through the real server before aborting the browser response; same-key retry has exactly one payment effect. A second regression commits before returning HTTP 503; it first failed when the client cleared the key. The client now retains keys on server/gateway errors and blocks replacement mutations until resolution; logout clears tenant-specific pending state.
- Missing authenticated runtime configuration refuses startup with exit 1. Mode-less routing is tested fail-closed. Local administrator provisioning through stdin was rehearsed against a unique synthetic identity, verified present, then removed. Secret values were neither printed nor committed.
- Loopback sign-in page inspected in the in-app browser at http://127.0.0.1:13022/workspace. Screenshot workspace-sign-in.png contains no credentials. Synthetic browser images contain only generated test accounts.

## Review and limits

Independent source review found and led to repairs for retained state across users, new-key resubmission after lost responses, and HTTP 5xx ambiguity. See ownership-design-review.md. The latter includes the server/transaction review and PostgreSQL evidence.

The auth foundation uses an absolute eight-hour server session with revocation. Idle locking and PIN unlock are **not implemented**. Provisioning/recovery and backup/restore are not consumer-ready flows. Broader bank/card spending integration, operational migrations/rollback, retention/export/erasure, bounded authentication-work concurrency and physical-device/accessibility review remain adoption work. This slice keeps card-specific functionality in the separate demo while bringing debt balances onto the new authoritative path; it does not claim the whole app is migrated.

Unconfirmed PDF expiry limits confirmation, not automatic database retention. No OCR or encrypted-document support; issuer/layout coverage is conservative and synthetic. Extracted rates/fees are stored as typed observations, not authoritative terms or posted events. Review errors never automatically mutate a balance. No real-PDF accuracy or legal/security certification is claimed.

ESLint 10's transitive plugin peer declarations still lag its version despite clean execution; Vite prints a future config-loader compatibility warning. Minimal production packaging, OS scanning and complete redistributed notices remain release gates. No dependency lifecycle scripts were enabled to silence build issues.
