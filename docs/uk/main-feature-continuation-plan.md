# Main feature continuation — 26 November 2026

The user authorized continued implementation with available parallel agents and normal pushes to main. Preserve the approved native UI, all private records and existing deployment boundaries.

## Contract

Extend the original main ledger through the same journal/receipt transaction, manual feature flag, origin/session validation and owner-scoped RLS. New adapters must validate payloads and stale versions; a failed save must retain the user's form and show an error. Keep exact GBP amounts and civil dates. Do not enable external providers or reuse private data for tests.

Goal allocations earmark existing cash, never add assets or move bank money. Subscription schedules describe expected bills, never post transactions automatically. Holdings record positions/cost with missing market prices explicit; dividends are record-only history and cannot silently add cash. Preserve future broader workflows without claiming them delivered.

## Tasks and ownership

1. Goals agent: goals, links and allocation plans server module/tests/native UI.
2. Preferences agent: subscriptions and safe settings server module/tests/native UI.
3. Investments agent: positions and record-only dividends server module/tests/native UI, offline valuation state.
4. Root: common dispatcher/read/client adapter integration, shared type changes, browser journeys and isolated Docker verification.
5. Independent review after implementers finish; fix findings, verify candidate, update preview/docs and push.

Shared files (`queries.ts`, command dispatcher, main data/types) belong to root. Agents supply wiring instructions rather than editing them concurrently. No migrations are planned; any need requires explicit coordination and additive handling. Existing schema already provides versioned records.

## Preflight

| Tasks     | Shared interface                               | Decision                                                                  |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| 1 / 4     | Goal command entities and main client          | Separate module; root wires within receipt transaction.                   |
| 2 / 4     | Subscription/settings entities and main client | Separate module; root wires; settings special singleton version.          |
| 3 / 4     | Holding/dividend entities and overview         | Separate module; root wires; missing value stays incomplete.              |
| 1 / 2 / 3 | DB flags/journal and account references        | Existing manual gate serializes financial commands, use owner connection. |
| 1         | Tests vs goal semantics                        | Earmarking only, reject invalid links, no change to balances.             |
| 2         | Tests vs scheduling                            | No payment posting, notification providers remain disabled.               |
| 3         | Tests vs valuation                             | No market fetch/cost-as-value; dividend history does not post cash.       |
| 4 / 5     | Verification/review                            | Dedicated synthetic DB; preserve real volumes and credentials.            |

Ruling: implement on the existing shared checkout because the user expressly authorized ongoing main work and push; scoped file ownership prevents simultaneous edits. Feature branch remains preserved. No forced history changes or manual deployment.
