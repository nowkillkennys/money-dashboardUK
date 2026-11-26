# Money Dashboard UK

A UK personal finance app adapting the original Money Dashboard interface into an authenticated, per-user bank and debt tracker. The current local slice connects the existing accounts, income, expenses, credit cards and reports to a shared PostgreSQL ledger, with All Debts and reviewed PDF statement imports alongside them.

This is a standalone repository with preserved [upstream provenance](UPSTREAM.md) and MIT attribution. It is not affiliated with the discontinued Money Dashboard service. It is an actively developed local application, not a finished public financial service.

## What works now

- Username/password sign-in, revocable eight-hour sessions and server-enforced per-user data isolation. No default password or public registration is shipped. Idle locking/PIN unlock is planned, not implemented.
- Native bank accounts, income/expenses/transfers, cards, linked purchases and bank-funded repayments. Existing card charge editing now saves the charge and linked expense together; see [editing behavior and statement review](docs/uk/card-charge-editing.md). A card purchase appears once in expenses; a repayment reduces bank cash and card debt once, without creating another spending expense.
- Card removal offers Archive or Permanently delete with a preview and typed-name confirmation. Archive hides the card and allows restoration; deletion removes card history while preserving bank-funded repayments and unlinking subscriptions. See [removal choices](docs/uk/card-removal-choices.md). Bank/card ordering saves atomically and survives reload; failed saves show an error and restore the displayed order.
- All Debts with manual tracking and reported balance/date anchors. Card and statement review share the same identity and payment/charge history rather than maintaining competing balances. Pending and unresolved items remain explicit.
- Local PDF text extraction and review before confirmation. Imports distinguish APR from simple annual rates, forecast interest from posted interest, and conditional percentage fees from actual charges. Observations are not automatically accepted as product terms or transactions. File hashes and transactional retry handling prevent duplicate effects.
- Subscription **Mark as Paid** records an already-made bank expense or card purchase and advances the billing date in one save, with duplicate-retry protection and a date/source confirmation. See [payment recording](docs/uk/subscription-payment-recording.md).
- GBP-focused writes and UK formatting, with Europe/London runtime configuration. Legacy multi-currency types remain in source; live FX and non-GBP write support are not active in this slice.

Goals/account earmarks, allocation templates, subscription schedules, safe settings, investment positions and record-only dividends now support authenticated writes. Schedules and position/history records do not silently post cash movements; missing market prices make net worth visibly incomplete. See the [feature continuation](docs/uk/main-feature-continuation.md) for semantics and verification. The original feature-rich shell and useful reconciliation/snapshot implementations remain preserved. Atomic contributions, automatic allocation, investment trade posting, correction/refund flows, duplicate reconciliation and automatic snapshots still remain. Reports and overview use the connected data; retained source or demo screens do not mean every original feature is operational.

See the [integration handover](docs/uk/main-app-integration.md) for exact scope and limitations, and the [migration plan](docs/uk/product-migration-plan.md) for the wider roadmap.

## Run locally

Use Docker with Compose and Node.js 22 to generate the private local configuration. A fresh checkout does not require a Supabase project, Gemini key or host dependency installation.

```sh
git clone https://github.com/nowkillkennys/money-dashboardUK.git
cd money-dashboardUK
node scripts/workspace-env.cjs
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml build workspace test
docker compose --env-file .uk-work/workspace.env -f compose.workspace.yml up -d --wait db workspace ingress
```

Open [http://127.0.0.1:13022/](http://127.0.0.1:13022/). `/workspace` redirects to `/debts` inside the main app. Create your own username/password using the [stdin-based provisioning instructions](docs/uk/authenticated-foundation.md#local-run-and-provisioning). Existing installations retain their existing login; do not publish credentials or place passwords in command arguments.

The generator retains existing configuration and writes new secrets only to ignored `.uk-work/workspace.env`. Keep that file private. Docker initializes the active [migration chain](migrations/workspace) **only on a new database volume**. Existing installations need reviewed additive upgrades; restarting does not apply new migrations. Do not run the historical `supabase/schema.sql` as the current UK setup, reset financial volumes, or run `down -v` on data you want to retain. Backup/restore and a versioned upgrade/rollback runner remain release gates.

The local app uses a loopback ingress, private Docker networking and non-root application containers. This setup is not an internet deployment recipe. Explicit application mode configuration is required; plain `pnpm dev` alone does not configure the authenticated product.

## Synthetic demo

For a separate sample-data preview:

```sh
docker compose -f compose.uk.yml build
docker compose -f compose.uk.yml up -d --wait
```

Open [http://localhost:13021/demo](http://localhost:13021/demo). Edits are in memory and reset on reload. Never enter real financial, identity, statement or password data in the demo. It has no personal database or financial connections and does not prove authenticated feature completeness. See [UK setup and boundaries](README.uk.md).

## Privacy and unfinished work

PDF handling uses local Poppler text extraction with file/page/time/output limits. It does not provide OCR for scanned statements or universal lender-format support. Missing or ambiguous fields require review/manual entry. Raw documents, full extracted text, holder names and full card numbers are not retained; structured review evidence and file hashes are retained. Preview expiry is not a deletion policy: retention, export and erasure workflows still need implementation.

External AI/Gemini, voice, live stock/FX feeds, push notifications and legacy shared-owner APIs are disabled or blocked in the authenticated build. Do not add model/provider credentials to enable inherited code paths. Open Banking, browser-led Very retrieval and email ingestion are planned independent methods, not working connections.

Recovery, credential rotation, backup/restore rehearsal, migration/rollback tooling, retention and security UX remain adoption gates. Public release additionally needs TLS, production hardening, accessibility/device validation and appropriate UK privacy, consumer and FCA-perimeter review. No FCA authorisation or compliance certification is claimed. Repository publication is not approval to migrate old financial records or deploy publicly. Retained Vercel configuration is historical; connected hosting may react to pushes, but a Git push does not configure a safe production installation.

## Development and verification

Built with Next.js/React, TypeScript, Tailwind/Radix, PostgreSQL, Recharts and local Poppler. Authentication and finance use separate database roles with owner-scoped transactional commands. The active setup does not use the inherited household PIN or fixed-owner Supabase gateway.

Recorded Docker verification for charge editing: 108 unit tests, 82 PostgreSQL tests and all 50 browser tests passed across five layouts. TypeScript and an offline production build passed; lint has no errors and one existing Credit Cards navigation warning. See [charge-editing evidence and limits](docs/uk/card-charge-editing.md#verification). These results cover the delivered slice, not every preserved feature or physical-device/security certification. Tests use a separate synthetic database; never point them or trace capture at private records.

Project guidance is in [claude.md](claude.md). Historical requirements and security findings remain linked from [README.uk.md](README.uk.md).

## License

[MIT](LICENSE), retaining the original 2025 Amir Shetaia copyright notice. Original source: [NightBaRron1412/money-dashboard](https://github.com/NightBaRron1412/money-dashboard). Dependencies, brands and other assets require their own rights review.
