# Local workspace ownership and authentication review

Reviewed the new isolated workspace seam against the fixed-owner upstream architecture. The runtime uses separate PostgreSQL roles for authentication and financial data; administrator credentials belong only to provisioning and migration tools. The authenticated workspace must start with `WORKSPACE_MODE=authenticated`, explicit database URLs and an exact `WORKSPACE_ORIGIN`. The preview and authenticated workspace use different localhost ports and databases.

The finance role is a non-owner without superuser or BYPASSRLS privileges. `withUserDb` checks out one connection, begins a transaction, sets transaction-local `app.user_id`, and commits or rolls back before releasing it. Every finance table needs both `USING` and `WITH CHECK` ownership policies with FORCE RLS. Composite owner/account foreign keys prevent one user's child rows referencing another user's account. Neither request bodies nor query parameters select the authenticated identity.

Authentication uses provisioned usernames, independently salted scrypt passwords, random 32-byte session tokens, and SHA-256 token digests in the database. Sessions expire after eight hours and are checked against disabled users on every lookup. Logout deletes the session digest. Cookies are HttpOnly, SameSite Strict, scoped to `/`, and Secure when the configured origin uses HTTPS. This local HTTP deployment remains restricted to loopback ingress. Login and writes require the configured exact Origin. The login limiter uses atomic PostgreSQL updates for a shared budget and hashed canonical username buckets.

Legacy API access must remain blocked by the authenticated route allowlist and by the upstream database helper. The new workspace must not mount the upstream PIN auth/data provider. No public registration, upstream credentials, cloud configuration, legacy database reads or private statement ingestion are required by this foundation.

## Verification

On 26 November 2026 the real isolated PostgreSQL tests in `tests/workspace/auth.test.ts` passed all six cases: distinct synthetic user authentication, stored token hashing and logout revocation; expiry and disabled users; parallel throttling; role privilege separation; foreign reads/writes and composite owner foreign keys; absent ownership context and transaction context cleanup after commit and rollback across the pooled connections. Tests create synthetic identities and remove their own rows, without resets or truncation.

HTTP route and browser checks remain separate from these database tests. In particular, verify logged-out workspace/API behavior, exact-origin checks, legacy route denial, no-store responses, and cookies through loopback ingress before claiming end-to-end completion.

## Idle locking preference

The current foundation has an absolute eight-hour session lifetime. It does not implement an idle timeout or a secondary PIN lock. A future preference could let a user choose automatic locking after inactivity, while preserving the server-side session as the authorization boundary. Before implementation, agree the timeout options, whether inactivity revokes the session or only hides the interface, how unlock works, and whether multiple tabs share activity. Hiding UI alone must never be described as revoking access.

## Scoped review verdict

The reviewed server boundary is suitable as a synthetic local foundation: provisioned authentication, per-user finance isolation, atomic debt commands, idempotency receipts, independent manual/PDF switches, and append-only balance snapshots form a coherent isolated seam. Four further real PostgreSQL security tests passed for overpayment rollback (including version and receipt), concurrent same-key replay and stale-version conflicts, pending payments through reconciliation and snapshot write restrictions, and PDF confirmation replay/foreign/expired-preview rejection. These tests use only synthetic identities and clean their own rows.

The client review identified retained state across sign-out and ambiguity when retrying a committed request. The implementation now clears tenant-specific retry/detail state on login/logout, blocks concurrent actions, and prevents replacement commands while an unacknowledged command awaits same-key retry. The final implementation also preserves the pending key on server-error responses because a failed commit acknowledgement or proxy error may follow a successful commit. Root observed the committed-then-503 regression fail before repair and all ten final browser checks pass across five profiles after repair; see authenticated-verification.md.

This verdict covers the synthetic local foundation and the inspected implementation. It does not approve private financial adoption, migrate old data, certify extraction accuracy for real statements, or establish backup/recovery and operational readiness. No private PDF, old database or credential files were inspected for this review.
