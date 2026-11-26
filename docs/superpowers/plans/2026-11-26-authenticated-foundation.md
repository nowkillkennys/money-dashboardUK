# Authenticated UK debt foundation implementation plan

**Goal:** deliver a separate working authenticated local debt workspace, with real two-user persistence/isolation, then reviewed statement/reconciliation ingestion using synthetic fixtures.

**Architecture:** retain Next/React and the approved demo. New typed server services use local PostgreSQL directly. Separate narrow auth role and non-owner FORCE-RLS finance role; migration credentials never enter runtime. Legacy single-household routes are disabled in authenticated mode. No cloud/provider/AI configuration or real-record migration.

**Accepted scope:** user approved continuation of security/dependency work then reconciliation/PDF migration. This implements the preferred Next/PostgreSQL architecture in docs/uk/product-migration-plan.md, without a new provider choice or aesthetics approval.

1. Dependency worker upgrades supported pinned framework/tooling and validates audit/build in Docker.
2. Auth worker implements provisioned local identities, scrypt credentials, revocable hashed opaque sessions, generic failures and DB-backed throttling. Root adds isolated DB/services and role tests. No public signup/recovery/email in this slice.
3. Domain worker extracts tested exact-money, reconciliation and typed PDF observations from historical code using synthetic text only.
4. Root implements owner-scoped bank/debt grouping, reported snapshot and payments, atomic idempotent versioned commands, expiry/hash-bounded PDF preview and confirm. Root builds retained-style workspace UI and explicit card grouping without liability double counting.
5. Run database integration tests for two identities, missing context, forged owner/foreign references, rollback, stale version, retry/conflict, failed login/database and session revocation. Browser test authenticated create/reload/reconcile/PDF on synthetic data; retain demo regression.
6. Independent security review, fix findings, record evidence and limitations, local commit only. Leave separate demo and authenticated previews clearly labelled.

Risks: legacy routes must fail closed; no caller-supplied ownership; no concurrent unsynchronised card/debt ledgers; decimal strings/minor units at authority boundary; statement candidates never automatically become posted interest; missing/ambiguous values require review. No runtime migration/reset. Database names/volumes are newly scoped; old apps and databases untouched.
