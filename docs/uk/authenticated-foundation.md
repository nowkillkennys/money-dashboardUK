> Historical foundation slice: the standalone workspace has now been embedded into the original main application. See [main-app-integration.md](main-app-integration.md) for current routes, shared schema and connected commands. Login provisioning instructions below remain valid.

# Authenticated local debt foundation

The approved Next/React base and synthetic demo remain. This slice introduces a separately running authenticated debt workspace; it does not replace the broader approved screens or import old financial records. Cards are one category within all debts alongside loans, catalogue, BNPL and monthly-fee accounts. Each obligation has one balance. The current workspace shows debt totals only, not available bank cash or net worth. Card charges/spending and bank-linked payments will be connected to this same authoritative model in a later slice, with explicit ID mapping rather than parallel balances.

## Working contract

- Provisioned username/password sign-in, salted scrypt hashes, generic failures and atomic database throttling. No public registration or email provider. Opaque random session tokens are stored only as SHA256 digests server-side. Cookies are HttpOnly/SameSite Strict, Secure when configured for HTTPS. Sessions expire after eight hours and logout revokes them in the database; disabled users and expired sessions are rejected. No idle timeout/PIN unlock exists yet. The user's preferred easy return after idle requires a separate server-enforced lock and re-authentication design.
- Two narrow runtime roles separate authentication from finance. Finance role neither owns tables nor bypasses RLS. Every operation runs in a transaction with server-derived owner context; FORCE RLS and composite owner/account foreign keys enforce isolation. Migration/admin credentials never enter the application runtime.
- Authoritative GBP uses validated decimal strings/integer pence. A reported balance and date remain distinct from the tracked estimate. Posted payments are explicitly included/excluded/unresolved when accepting a new statement. Pending payments are preserved and never deducted as posted. Unresolved accounts are excluded from the tracked total with an explicit count; the total is not presented as a complete liability figure.
- Commands lock rows, enforce versions, retain owner-scoped request fingerprints and receipts, and commit all effects atomically. Same-key retries have one effect; conflicting reuse and stale versions reject. Unknown transport outcomes keep the original request key and block new mutations until resolved. A logout clears private client state. No bank transaction is silently created by a debt payment.
- Manual/PDF switches are persisted per owner and enforced server-side. PDF uploads are raw application/pdf up to 5 MiB; local Poppler extraction has page/time/output/concurrency bounds and private temporary files removed in finally. No raw document, holder name, full PAN or text is stored/logged. Extracted candidates and typed observations are reviewed before an explicit account confirmation. Rates distinguished from APR, forecast interest distinguished from posted interest, and conditional percentage fees distinguished from charges remain intact.
- Owner-scoped file hashes prevent repeat confirmations. Unconfirmed previews expire for confirmation after 30 minutes and can be re-extracted. A confirmed PDF becomes retained extraction evidence linked to an append-only reported snapshot, including the user's payment decisions. Extracted rates/fees remain observations, not authoritative product terms or posted events. Expiry is an access/confirmation limit, not an automatic database deletion policy. A scheduled retention purge/export/erasure workflow remains a gate before real-record use.
- Legacy single-household APIs, market feeds, AI, push and service-worker routes are blocked in authenticated mode; legacy Supabase/session helpers also refuse that mode. An unspecified app mode fails closed. Demo API writes stay blocked. No external accounts/model calls or cloud provisioning.

## Local run and provisioning

Run from `/Users/daniel/money-dashboard-uk`. Docker is required; no host dependency install.

```sh
node scripts/workspace-env.cjs
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml build workspace test
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml up -d --wait db workspace ingress
```

Open http://127.0.0.1:13022/workspace. The 127.0.0.1 host keeps its cookie separate from the existing localhost demos. The application and PostgreSQL have only a private internal Docker network; non-root Nginx publishes a fixed proxy on loopback. The application is non-root/read-only with temporary extraction/cache storage and no host credential mounts. Database storage uses only the new `money-dashboard-uk-workspace_workspace-data` volume. Never remove/reset existing application databases or run `down -v` on financial data.

Initial migrations in migrations/workspace run only when this new database is first initialized. There is no automatic schema mutation on application start. This slice's development-only new schema additions were explicitly applied to its isolated synthetic store; a versioned upgrade/rollback runner and backup/restore rehearsal are required before private adoption.

To create your own local login, choose a username and a password of at least 12 characters (up to 256 in the UI). In zsh, read the password without echoing it or putting it in shell history:

```sh
read -rs 'WORKSPACE_NEW_PASSWORD?New workspace password: '; echo
printf '%s' "$WORKSPACE_NEW_PASSWORD" | docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml run --rm -T --no-deps provision pnpm exec tsx scripts/workspace-user.ts your-username
unset WORKSPACE_NEW_PASSWORD
```

The provisioning command has administrator access only in its one-off container; passwords travel via stdin and are not printed. The private .uk-work/workspace.env file is generated with restrictive permissions, ignored by Git and Docker context, and never printed. Do not share it. No default personal login/password is shipped. Browser/database tests use a separate db-test service/volume and isolated synthetic provisioned users and remove their own rows; test traces must never be used with real credentials or statements.

## Validation and remaining gates

Executed evidence is in authenticated-verification.md; dependency remediation, pure domain port and independent ownership review have separate reports. This is an engineering slice, not security/compliance certification or permission to migrate private records.

Before private adoption: versioned migrations/rollback, backup/restore, retention/export/erasure, credential rotation/recovery and per-user security UX; broader account/card/bank linking and correction audit coverage; independent release security review and OS/image scanning. Before public release additionally require TLS, hardened production packaging/CSP, current provider/consumer/privacy/accessibility/perimeter review and physical-device/accessibility evidence. Budgeting, debt cost scenarios, product-specific terms and optional retrieval retain the scope in product-migration-plan.md. External/live AI remains disabled.
