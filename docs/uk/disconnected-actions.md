# Authenticated main app: remaining disconnected actions

Source inventory updated on 26 November 2026 after restoring the remaining three migration gaps. This is source evidence only: no tests, browser, database, environment files or private records were inspected. Paths below are repository relative. This does not establish that every connected feature works at runtime.

## Migration gaps with existing user-facing controls

| Action                                                 | Current source evidence                                                                                                                                                                                                                                                                                                                                     | Priority                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Delete an individual card charge or payment            | Restored through `charge.delete` and `payment.delete`. Confirmations describe linked-expense removal or bank restoration; affected statement balances are flagged for review. See [deletion details](card-history-deletion.md). Test suites remain paused.                                                                                                  | Restored; runtime untested |
| Link a bank refund to an expense | Restored through owner-scoped transaction commands with a shared bank/card refund cap and original-expense protection. | Restored; runtime untested |
| Link a card credit/refund to an expense | Restored for creation and editing through versioned card payment commands; the refund picker is available again. | Restored; runtime untested |
| Account reconcile and duplicate merge/delete/keep-both | Restored through workspace reconciliation sessions and atomic actions checking both displayed transaction versions. | Restored; runtime untested |
| Goal contribution                                      | Restored in this workstream through `goal.contribute` and the existing dialog. Transfer and selected fixed earmarks save together; automatic links stay automatic. See [restoration details](goal-contribution-restoration.md). Compilation/build passed; runtime tests are paused by user instruction.                                                     | Restored; runtime untested |
| Daily net-worth snapshot capture | Restored on the authenticated overview for the current London day, only when cash/debt valuation is complete. See [restoration details](remaining-restorations.md). | Restored; runtime untested |

## Existing capabilities that should not be called disconnected

- Goal/account earmarks and allocation-plan create/edit/delete/activation use authenticated commands (`lib/money/queries.ts:490`, `:554`–`:614`; `lib/workspace/main-goals.ts`). Phase 2 calls `setActivePlan`, so activation is connected when a matching plan exists (`app/goals/goals-content.tsx:420`). If no plan name contains “phase 2”, that handler simply dismisses the prompt; it creates no plan.
- Income “Apply saved allocations” still prefills editable split fields. Authenticated submission now commits the income and all selected transfers atomically under one retry receipt, with observed account versions and exact split-total checks. Automatic application remains disabled. See [income allocation details](income-allocation-saving.md).
- Ordinary transaction editing/deletion has authenticated branches (`lib/money/queries.ts:270`, `:297`). Linked refunds are now connected too; see the restoration details above. Card charge/payment editing, card ordering/removal and subscription payment recording have dedicated authenticated paths; their runtime correctness is outside this audit.
- Pending-command retry exists (`lib/workspace/main-client.ts:79`–`:204`; `app/components/main-command-retry.tsx`). That is recovery of command outcomes, not data backup or password recovery.

## Intentional exclusions and capabilities needing a separate build

- **External AI, voice/provider calls, live prices and web push:** intentionally disabled by the authenticated boundary, not restoration work to bypass. `proxy.ts:5`–`:20` allows `/api/workspace/*`, returns offline prices for `/api/stocks`, and rejects other APIs/service worker. `app/chat/page.tsx` and dashboard identify AI as disabled. Settings hides background-push settings in authenticated mode (`app/settings/settings-content.tsx:491`) and explains external notifications are off (`:195`). Local dashboard reminders still run and may show toasts/browser Notification prompts (`app/dashboard-content.tsx:287`–`:328`); “all notifications disabled” would be inaccurate.
- **Investment trades/valuation — intentionally out of scope by user decision (26 November 2026):** authenticated screen deliberately supports position/cost-basis and dividend-history CRUD, not cash-settled buys/sells, automatic reinvestment or current valuation (`app/stocks/authenticated-investments.tsx:33`–`:38`; `lib/workspace/main-investments.ts:4`). The legacy trading UI is replaced (`app/stocks/stocks-content.tsx:1499`). Price refresh cannot restore valuation while the provider remains off.
- **Backup/export, account/password recovery and idle lock:** no corresponding user action/implementation was found in the inspected authenticated app/settings/auth sources. Treat these as unbuilt or requiring specification, not confirmed formerly working buttons. Auth session recheck on visibility exists (`app/auth-provider.tsx:98`) and session expiration is enforced (`lib/workspace/auth.ts:94`); neither establishes an inactivity lock. No claim is made about operational backup systems outside this repository.

## Boundary to preserve

Authenticated APIs use workspace session and checked-write handling (`app/api/workspace/main-commands/route.ts:16`). Legacy handlers additionally use the legacy auth/data gateway (`app/api/contribute/route.ts:6`, `app/api/reconcile/route.ts:6`, `app/api/duplicates/route.ts:6`, `app/api/snapshots/capture/route.ts:26`); `lib/supabase-server.ts:18` and `:299` explicitly disable that gateway/session in authenticated mode. Restore required behavior through owner-scoped workspace commands rather than reopening legacy routes.

## Testing instruction

The user paused automated unit, integration and browser tests until they explicitly ask to resume. Compilation/build and source inspection can continue. Do not label new restoration work fully tested using earlier release counts.
