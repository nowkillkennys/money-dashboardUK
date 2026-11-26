import {
  isAuthenticatedMainApp,
  getMainData,
  mainCommand,
  mainCommandRow,
  mainVersion,
  unavailableMainMutation,
} from "@/lib/workspace/main-client";
import { validateRefund } from "./refunds";
import { supabase } from "@/lib/supabase";
import type {
  Account,
  Transaction,
  Goal,
  GoalAccount,
  AllocationPlan,
  Settings,
  Holding,
  Subscription,
  Dividend,
  CreditCard,
  CreditCardCharge,
  CreditCardPayment,
  CurrencyCode,
  NetWorthSnapshot,
} from "./database.types";
import { OWNER_ID } from "./constants";

export interface GoalAccountLinkInput {
  account_id: string;
  allocated_amount?: number | null;
}

import {
  demoCreateAccount,
  demoUpdateAccount,
  demoDeleteAccount,
  demoCreateTransaction,
  demoUpdateTransaction,
  demoDeleteTransaction,
  demoCreateGoal,
  demoUpdateGoal,
  demoDeleteGoal,
  demoAddGoalAccountAllocation,
  demoSetGoalAccounts,
  demoCreateAllocationPlan,
  demoUpdateAllocationPlan,
  demoDeleteAllocationPlan,
  demoSetActivePlan,
  demoUpsertSettings,
  demoCreateHolding,
  demoUpdateHolding,
  demoDeleteHolding,
  demoCreateSubscription,
  demoUpdateSubscription,
  demoDeleteSubscription,
  demoCreateDividend,
  demoUpdateDividend,
  demoDeleteDividend,
  demoCreateCreditCard,
  demoUpdateCreditCard,
  demoDeleteCreditCard,
  demoCreateCreditCardCharge,
  demoUpdateCreditCardCharge,
  demoDeleteCreditCardCharge,
  demoCreateCreditCardPayment,
  demoDeleteCreditCardPayment,
} from "./demo-store";

export function isDemoModeRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/demo");
}

/* ================================================================== */
/*  Accounts                                                          */
/* ================================================================== */

export async function getAccounts() {
  if (isAuthenticatedMainApp()) return (await getMainData()).accounts;
  const { data, error } = await supabase
    .from("money_accounts")
    .select("*")
    .order("archived", { ascending: true })
    .order("position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Account[];
}

export async function createAccount(account: {
  name: string;
  type: Account["type"];
  currency?: Account["currency"];
  starting_balance?: number;
}) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Account>(
      "bank.create",
      {
        ...account,
        currency: account.currency ?? "GBP",
        starting_balance: account.starting_balance ?? 0,
      },
      "accounts"
    );
  }
  if (isDemoModeRoute())
    return demoCreateAccount({
      ...account,
      currency: account.currency ?? "CAD",
      starting_balance: account.starting_balance ?? 0,
    });
  const { data, error } = await supabase
    .from("money_accounts")
    .insert({
      name: account.name,
      type: account.type,
      currency: account.currency ?? "CAD",
      starting_balance: account.starting_balance ?? 0,
      user_id: OWNER_ID,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function updateAccount(
  id: string,
  updates: {
    name?: string;
    type?: Account["type"];
    currency?: Account["currency"];
    starting_balance?: number;
    color?: string | null;
    archived?: boolean;
    position?: number;
  }
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Account>(
      "bank.update",
      { id, ...updates, version: await mainVersion("accounts", id) },
      "accounts"
    );
  }
  if (isDemoModeRoute()) return demoUpdateAccount(id, updates);
  const { data, error } = await supabase
    .from("money_accounts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Account;
}

export async function deleteAccount(id: string) {
  if (isAuthenticatedMainApp()) {
    await mainCommand("bank.delete", { id, version: await mainVersion("accounts", id) });
    return;
  }
  if (isDemoModeRoute()) {
    demoDeleteAccount(id);
    return;
  }
  await supabase.from("money_transactions").update({ account_id: null }).eq("account_id", id);
  await supabase
    .from("money_transactions")
    .update({ from_account_id: null })
    .eq("from_account_id", id);
  await supabase.from("money_transactions").update({ to_account_id: null }).eq("to_account_id", id);
  await supabase.from("money_holdings").delete().eq("account_id", id);
  await supabase.from("money_goal_accounts").delete().eq("account_id", id);
  await supabase
    .from("money_credit_card_payments")
    .update({ account_id: null })
    .eq("account_id", id);
  const { error } = await supabase.from("money_accounts").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Transactions                                                      */
/* ================================================================== */

export async function getTransactions(filters?: {
  type?: Transaction["type"];
  accountId?: string;
  from?: string;
  to?: string;
  category?: string;
}) {
  if (isAuthenticatedMainApp())
    return (await getMainData()).transactions.filter(
      (tx) =>
        (!filters?.type || tx.type === filters.type) &&
        (!filters?.accountId || tx.account_id === filters.accountId) &&
        (!filters?.from || tx.date >= filters.from) &&
        (!filters?.to || tx.date <= filters.to) &&
        (!filters?.category || tx.category === filters.category)
    );
  let q = supabase
    .from("money_transactions")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters?.type) q = q.eq("type", filters.type);
  if (filters?.accountId) q = q.eq("account_id", filters.accountId);
  if (filters?.from) q = q.gte("date", filters.from);
  if (filters?.to) q = q.lte("date", filters.to);
  if (filters?.category) q = q.eq("category", filters.category);

  const { data, error } = await q;
  if (error) throw error;
  return data as Transaction[];
}

export async function createTransaction(
  tx: Omit<
    Transaction,
    | "id"
    | "created_at"
    | "user_id"
    | "linked_charge_id"
    | "idempotency_key"
    | "received_amount"
    | "exclude_from_monthly"
    | "goal_id"
  > & {
    linked_charge_id?: string | null;
    idempotency_key?: string | null;
    exclude_from_monthly?: boolean;
    goal_id?: string | null;
    received_amount?: number | null;
  }
) {
  if (isAuthenticatedMainApp()) {
    const { linked_charge_id, refund_of_transaction_id, refunded_amount, ...input } = tx;
    if (linked_charge_id || refund_of_transaction_id || refunded_amount)
      return unavailableMainMutation();
    return mainCommandRow<Transaction>("transaction.create", input, "transactions");
  }
  if (isDemoModeRoute())
    return demoCreateTransaction({
      ...tx,
      linked_charge_id: tx.linked_charge_id ?? null,
      idempotency_key: tx.idempotency_key ?? null,
      received_amount: tx.received_amount ?? null,
    });
  const { data, error } = await supabase
    .from("money_transactions")
    .insert({
      ...tx,
      linked_charge_id: tx.linked_charge_id ?? null,
      idempotency_key: tx.idempotency_key ?? null,
      received_amount: tx.received_amount ?? null,
      exclude_from_monthly: tx.exclude_from_monthly ?? false,
      goal_id: tx.goal_id ?? null,
      user_id: OWNER_ID,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

export async function deleteTransaction(id: string) {
  if (isAuthenticatedMainApp()) {
    await mainCommand("transaction.delete", { id, version: await mainVersion("transactions", id) });
    return;
  }
  if (isDemoModeRoute()) {
    demoDeleteTransaction(id);
    return;
  }
  // Also delete linked credit-card charge if one exists
  const { data: tx } = await supabase
    .from("money_transactions")
    .select("linked_charge_id")
    .eq("id", id)
    .single();
  if (tx?.linked_charge_id) {
    // Clear the back-link first so the cascade doesn't loop
    await supabase
      .from("money_credit_card_charges")
      .update({ linked_transaction_id: null })
      .eq("id", tx.linked_charge_id);
    await supabase.from("money_credit_card_charges").delete().eq("id", tx.linked_charge_id);
  }
  const { error } = await supabase.from("money_transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Omit<Transaction, "id" | "created_at" | "user_id">>
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Transaction>(
      "transaction.update",
      { id, ...updates, version: await mainVersion("transactions", id) },
      "transactions"
    );
  }
  if (isDemoModeRoute()) return demoUpdateTransaction(id, updates);
  const { data, error } = await supabase
    .from("money_transactions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const tx = data as Transaction;
  // Sync changes to linked CC charge if one exists
  if (tx.linked_charge_id) {
    const chargeUpdates: Record<string, unknown> = {};
    if (updates.date !== undefined) chargeUpdates.date = updates.date;
    if (updates.amount !== undefined) chargeUpdates.amount = updates.amount;
    if (updates.merchant !== undefined) chargeUpdates.merchant = updates.merchant;
    if (updates.category !== undefined) chargeUpdates.category = updates.category;
    if (Object.keys(chargeUpdates).length > 0) {
      await supabase
        .from("money_credit_card_charges")
        .update(chargeUpdates)
        .eq("id", tx.linked_charge_id);
    }
  }
  return tx;
}

/* ================================================================== */
/*  Goals                                                             */
/* ================================================================== */

export async function getGoals() {
  if (isAuthenticatedMainApp()) return (await getMainData()).goals;
  const { data, error } = await supabase.from("money_goals").select("*").order("created_at");
  if (error) throw error;
  return data as Goal[];
}

export async function getGoalAccounts() {
  if (isAuthenticatedMainApp()) return (await getMainData()).goalAccounts;
  const { data, error } = await supabase
    .from("money_goal_accounts")
    .select("*")
    .order("created_at");
  if (error) {
    // Backward-compatible fallback when the migration has not run yet.

    return [] as GoalAccount[];
  }
  return data as GoalAccount[];
}

function normalizeGoalAccountLinks(
  linksOrIds: Array<string | GoalAccountLinkInput> | undefined
): GoalAccountLinkInput[] {
  if (!linksOrIds || linksOrIds.length === 0) return [];
  const byAccountId = new Map<string, GoalAccountLinkInput>();
  for (const linkOrId of linksOrIds) {
    const accountId = typeof linkOrId === "string" ? linkOrId : linkOrId.account_id;
    if (!accountId) continue;
    const rawAmount = typeof linkOrId === "string" ? null : (linkOrId.allocated_amount ?? null);
    const amount =
      rawAmount === null || rawAmount === undefined || !Number.isFinite(rawAmount)
        ? null
        : Math.max(0, rawAmount);
    byAccountId.set(accountId, {
      account_id: accountId,
      allocated_amount: amount,
    });
  }
  return Array.from(byAccountId.values());
}

async function setGoalAccounts(goalId: string, linksOrIds: Array<string | GoalAccountLinkInput>) {
  // Replace links in one shot to keep writes simple.
  const { error: deleteError } = await supabase
    .from("money_goal_accounts")
    .delete()
    .eq("goal_id", goalId);
  if (deleteError) {
    // Fallback when table does not exist yet.

    return;
  }
  const uniqueLinks = normalizeGoalAccountLinks(linksOrIds);
  if (uniqueLinks.length === 0) return;
  const { error: insertError } = await supabase.from("money_goal_accounts").insert(
    uniqueLinks.map((link) => ({
      user_id: OWNER_ID,
      goal_id: goalId,
      account_id: link.account_id,
      allocated_amount: link.allocated_amount ?? null,
    }))
  );
  if (insertError) {
  }
}

export async function createGoal(
  goal: Omit<Goal, "id" | "created_at" | "user_id" | "completed_at"> & {
    completed_at?: string | null;
  },
  linkedAccounts?: Array<string | GoalAccountLinkInput>
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Goal>(
      "goal.create",
      { ...goal, ...(linkedAccounts !== undefined ? { linked_accounts: linkedAccounts } : {}) },
      "goals"
    );
  }
  if (isDemoModeRoute()) {
    const ids = linkedAccounts?.map((l) => (typeof l === "string" ? l : l.account_id));
    return demoCreateGoal(goal, ids);
  }
  const normalizedLinks = normalizeGoalAccountLinks(linkedAccounts);
  const normalizedLinkedId =
    normalizedLinks.length > 0 ? normalizedLinks[0].account_id : goal.linked_account_id;
  const { data, error } = await supabase
    .from("money_goals")
    .insert({ ...goal, linked_account_id: normalizedLinkedId ?? null, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  if (linkedAccounts) {
    await setGoalAccounts(data.id, normalizedLinks);
  }
  return data as Goal;
}

export async function updateGoal(
  id: string,
  updates: Partial<Goal>,
  linkedAccounts?: Array<string | GoalAccountLinkInput>
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Goal>(
      "goal.update",
      {
        ...updates,
        id,
        version: await mainVersion("goals", id),
        ...(linkedAccounts !== undefined ? { linked_accounts: linkedAccounts } : {}),
      },
      "goals"
    );
  }
  if (isDemoModeRoute()) {
    const ids = linkedAccounts?.map((l) => (typeof l === "string" ? l : l.account_id));
    return demoUpdateGoal(id, updates, ids);
  }
  const normalizedLinks = normalizeGoalAccountLinks(linkedAccounts);
  const normalizedLinkedId =
    linkedAccounts !== undefined
      ? (normalizedLinks[0]?.account_id ?? null)
      : updates.linked_account_id;
  const { data, error } = await supabase
    .from("money_goals")
    .update(
      linkedAccounts !== undefined ? { ...updates, linked_account_id: normalizedLinkedId } : updates
    )
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  if (linkedAccounts !== undefined) {
    await setGoalAccounts(id, normalizedLinks);
  }
  return data as Goal;
}

export async function deleteGoal(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("goal.delete", { id, version: await mainVersion("goals", id) });
  }
  if (isDemoModeRoute()) {
    demoDeleteGoal(id);
    return;
  }
  const { error } = await supabase.from("money_goals").delete().eq("id", id);
  if (error) throw error;
}

export async function addGoalAccountAllocation(
  goalId: string,
  accountId: string,
  amountToAdd: number
) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("goal.increment", {
      id: goalId,
      version: await mainVersion("goals", goalId),
      account_id: accountId,
      amount: amountToAdd,
    });
  }
  if (isDemoModeRoute()) {
    demoAddGoalAccountAllocation(goalId, accountId, amountToAdd);
    return;
  }
  const delta = Number.isFinite(amountToAdd) ? Math.max(0, amountToAdd) : 0;
  if (delta <= 0) return;

  const { data: existing, error: selectError } = await supabase
    .from("money_goal_accounts")
    .select("id, allocated_amount")
    .eq("goal_id", goalId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    const current = existing.allocated_amount ?? 0;
    const { error: updateError } = await supabase
      .from("money_goal_accounts")
      .update({ allocated_amount: current + delta })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase.from("money_goal_accounts").insert({
    user_id: OWNER_ID,
    goal_id: goalId,
    account_id: accountId,
    allocated_amount: delta,
  });
  if (insertError) throw insertError;
}

/* ================================================================== */
/*  Allocation Plans                                                  */
/* ================================================================== */

export async function getAllocationPlans() {
  if (isAuthenticatedMainApp()) return (await getMainData()).plans;
  const { data, error } = await supabase
    .from("money_allocation_plans")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return data as AllocationPlan[];
}

export async function setActivePlan(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<AllocationPlan>(
      "allocation.activate",
      { id, version: await mainVersion("plans", id) },
      "plans"
    );
  }
  if (isDemoModeRoute()) return demoSetActivePlan(id);
  // Deactivate all, then activate the chosen one
  await supabase
    .from("money_allocation_plans")
    .update({ is_active: false })
    .eq("user_id", OWNER_ID);
  const { data, error } = await supabase
    .from("money_allocation_plans")
    .update({ is_active: true })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as AllocationPlan;
}

export async function createAllocationPlan(
  plan: Omit<AllocationPlan, "id" | "created_at" | "user_id">
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<AllocationPlan>("allocation.create", { ...plan }, "plans");
  }
  if (isDemoModeRoute()) return demoCreateAllocationPlan(plan);
  const { data, error } = await supabase
    .from("money_allocation_plans")
    .insert({ ...plan, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as AllocationPlan;
}

export async function updateAllocationPlan(id: string, updates: Partial<AllocationPlan>) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<AllocationPlan>(
      "allocation.update",
      { ...updates, id, version: await mainVersion("plans", id) },
      "plans"
    );
  }
  if (isDemoModeRoute()) return demoUpdateAllocationPlan(id, updates);
  const { data, error } = await supabase
    .from("money_allocation_plans")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as AllocationPlan;
}

export async function deleteAllocationPlan(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("allocation.delete", { id, version: await mainVersion("plans", id) });
  }
  if (isDemoModeRoute()) {
    demoDeleteAllocationPlan(id);
    return;
  }
  const { error } = await supabase.from("money_allocation_plans").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Settings                                                          */
/* ================================================================== */

export const SETTINGS_SAFE_COLUMNS =
  "id, user_id, base_currency, display_name, greeting_tone, expense_categories, subscription_categories, rent_amount, rent_day, rent_reminder_days, bill_reminder_days, monthly_essentials_budget, paycheck_amount, paycheck_frequency, auto_apply_allocation, dismissed_merchants, created_at";

export async function getSettings() {
  if (isAuthenticatedMainApp()) return (await getMainData()).settings;
  const { data, error } = await supabase
    .from("money_settings")
    .select(SETTINGS_SAFE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data as Settings | null; // pin_hash, failed_attempts, locked_until are undefined (not selected)
}

export async function upsertSettings(settings: Partial<Settings>) {
  if (isAuthenticatedMainApp()) {
    await mainCommand("settings.upsert", { ...settings });
    return (await getMainData()).settings!;
  }
  if (isDemoModeRoute()) return demoUpsertSettings(settings);
  const existing = await getSettings();
  if (existing) {
    const { data, error } = await supabase
      .from("money_settings")
      .update(settings)
      .eq("id", existing.id)
      .select(SETTINGS_SAFE_COLUMNS)
      .single();
    if (error) throw error;
    return data as Settings;
  } else {
    const { data, error } = await supabase
      .from("money_settings")
      .insert({
        user_id: OWNER_ID,
        base_currency: "CAD",
        display_name: "Amir",
        greeting_tone: "coach",
        expense_categories: [
          "Food",
          "Transport",
          "Bills",
          "Rent",
          "Fun",
          "Health",
          "Personal Care",
          "Other",
        ],
        subscription_categories: [
          "Streaming",
          "Music",
          "Software",
          "Cloud",
          "Gaming",
          "News",
          "Fitness",
          "Food",
          "Finance",
          "Other",
        ],
        rent_amount: 2100,
        rent_day: 28,
        rent_reminder_days: 7,
        bill_reminder_days: 3,
        monthly_essentials_budget: 3000,
        paycheck_amount: 3400,
        paycheck_frequency: "bi-weekly" as const,
        auto_apply_allocation: true,
        dismissed_merchants: [],
        ...settings,
      })
      .select(SETTINGS_SAFE_COLUMNS)
      .single();
    if (error) throw error;
    return data as Settings;
  }
}

/* ================================================================== */
/*  Seed Data – runs once on first login                               */
/* ================================================================== */

export async function seedDefaultData() {
  if (isAuthenticatedMainApp()) {
    return unavailableMainMutation();
  }
  // Check if already seeded
  const { data: existing } = await supabase
    .from("money_accounts")
    .select("id")
    .eq("user_id", OWNER_ID)
    .limit(1);
  if (existing && existing.length > 0) return;

  const uid = OWNER_ID;

  // Create accounts
  const accountDefs = [
    { name: "Bills", type: "checking" as const, currency: "CAD" as const },
    { name: "Emergency", type: "checking" as const, currency: "CAD" as const },
    { name: "Car", type: "checking" as const, currency: "CAD" as const },
    { name: "Personal", type: "checking" as const, currency: "CAD" as const },
    { name: "Brokerage", type: "investing" as const, currency: "CAD" as const },
  ];

  const { data: accounts, error: accErr } = await supabase
    .from("money_accounts")
    .insert(accountDefs.map((a) => ({ ...a, user_id: uid })))
    .select();
  if (accErr) throw accErr;

  const acctMap: Record<string, string> = {};
  for (const a of accounts!) {
    acctMap[a.name] = a.id;
  }

  // Create goals
  const { data: seededGoals, error: goalErr } = await supabase
    .from("money_goals")
    .insert([
      {
        user_id: uid,
        name: "Emergency Fund",
        target_amount: 20000,
        linked_account_id: acctMap["Emergency"],
      },
      {
        user_id: uid,
        name: "Car Fund",
        target_amount: 25000,
        linked_account_id: acctMap["Car"],
      },
      {
        user_id: uid,
        name: "Investing",
        target_amount: null,
        linked_account_id: acctMap["Brokerage"],
      },
    ])
    .select();
  if (goalErr) throw goalErr;

  // Seed many-to-many goal links when the table exists.
  if (seededGoals && seededGoals.length > 0) {
    const goalIdByName = Object.fromEntries(
      seededGoals.map((goal) => [goal.name, goal.id])
    ) as Record<string, string>;
    const { error: goalLinkErr } = await supabase.from("money_goal_accounts").insert([
      {
        user_id: uid,
        goal_id: goalIdByName["Emergency Fund"],
        account_id: acctMap["Emergency"],
        allocated_amount: null,
      },
      {
        user_id: uid,
        goal_id: goalIdByName["Car Fund"],
        account_id: acctMap["Car"],
        allocated_amount: null,
      },
      {
        user_id: uid,
        goal_id: goalIdByName["Investing"],
        account_id: acctMap["Brokerage"],
        allocated_amount: null,
      },
    ]);
    if (goalLinkErr) {
    }
  }

  // Create allocation plans
  await supabase.from("money_allocation_plans").insert([
    {
      user_id: uid,
      name: "Phase 1: Emergency First",
      is_active: true,
      allocations: {
        Bills: 1500,
        Emergency: 1500,
        Car: 250,
        Invest: 100,
        Personal: 50,
      },
    },
    {
      user_id: uid,
      name: "Phase 2: After Emergency",
      is_active: false,
      allocations: {
        Bills: 1500,
        Car: 1350,
        Invest: 400,
        Personal: 150,
        Emergency: 0,
      },
    },
  ]);

  // Create default settings
  await supabase.from("money_settings").insert({
    user_id: uid,
    base_currency: "CAD",
    display_name: "Amir",
    greeting_tone: "coach",
    expense_categories: [
      "Food",
      "Transport",
      "Bills",
      "Rent",
      "Fun",
      "Health",
      "Personal Care",
      "Other",
    ],
    subscription_categories: [
      "Streaming",
      "Music",
      "Software",
      "Cloud",
      "Gaming",
      "News",
      "Fitness",
      "Food",
      "Finance",
      "Other",
    ],
    rent_amount: 2100,
    rent_day: 28,
    rent_reminder_days: 7,
    bill_reminder_days: 3,
    monthly_essentials_budget: 3000,
    paycheck_amount: 3400,
    paycheck_frequency: "bi-weekly",
    auto_apply_allocation: true,
    dismissed_merchants: [],
  });
}

/* ================================================================== */
/*  Holdings                                                          */
/* ================================================================== */

export async function getHoldings() {
  if (isAuthenticatedMainApp()) return (await getMainData()).holdings;
  const { data, error } = await supabase.from("money_holdings").select("*").order("created_at");
  if (error) {
    // Table may not exist yet — return empty array instead of crashing

    return [] as Holding[];
  }
  return data as Holding[];
}

export async function createHolding(holding: {
  account_id: string;
  symbol: string;
  shares: number;
  cost_basis: number;
  cost_currency?: Holding["cost_currency"];
}) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Holding>("holding.create", { ...holding }, "holdings");
  }
  if (isDemoModeRoute())
    return demoCreateHolding({ ...holding, cost_currency: holding.cost_currency ?? "USD" });
  const { data, error } = await supabase
    .from("money_holdings")
    .insert({
      ...holding,
      cost_currency: holding.cost_currency ?? "USD",
      user_id: OWNER_ID,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Holding;
}

export async function updateHolding(
  id: string,
  updates: {
    shares?: number;
    cost_basis?: number;
    cost_currency?: Holding["cost_currency"];
    symbol?: string;
    account_id?: string;
  }
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Holding>(
      "holding.update",
      { ...updates, id, version: await mainVersion("holdings", id) },
      "holdings"
    );
  }
  if (isDemoModeRoute()) return demoUpdateHolding(id, updates);
  const { data, error } = await supabase
    .from("money_holdings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Holding;
}

export async function deleteHolding(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("holding.delete", { id, version: await mainVersion("holdings", id) });
  }
  if (isDemoModeRoute()) {
    demoDeleteHolding(id);
    return;
  }
  const { error } = await supabase.from("money_holdings").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

export function computeAccountBalance(
  accountId: string,
  transactions: Transaction[],
  startingBalance: number = 0,
  creditCardPayments?: CreditCardPayment[]
): number {
  let balance = startingBalance;
  for (const tx of transactions) {
    if (tx.type === "income" && tx.account_id === accountId) {
      balance += tx.amount;
    } else if (tx.type === "expense" && tx.account_id === accountId) {
      balance -= tx.amount;
    } else if (tx.type === "transfer") {
      if (tx.from_account_id === accountId) balance -= tx.amount;
      if (tx.to_account_id === accountId) balance += tx.received_amount ?? tx.amount;
    } else if (tx.type === "correction") {
      if (tx.to_account_id === accountId) balance += tx.amount;
      if (tx.from_account_id === accountId) balance -= tx.amount;
    }
  }
  // Subtract credit card payments made from this account
  if (creditCardPayments) {
    for (const p of creditCardPayments) {
      if (p.account_id === accountId) {
        balance -= p.amount;
      }
    }
  }
  return balance;
}

export function getMonthRange(date: Date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const from = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
  return { from, to };
}

/* ================================================================== */
/*  Subscriptions                                                     */
/* ================================================================== */

export async function getSubscriptions() {
  if (isAuthenticatedMainApp()) return (await getMainData()).subscriptions;
  const { data, error } = await supabase
    .from("money_subscriptions")
    .select("*")
    .order("next_billing");
  if (error) {
    return [] as Subscription[];
  }
  return data as Subscription[];
}

export async function createSubscription(sub: Omit<Subscription, "id" | "created_at" | "user_id">) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Subscription>("subscription.create", { ...sub }, "subscriptions");
  }
  if (isDemoModeRoute()) return demoCreateSubscription(sub);
  const { data, error } = await supabase
    .from("money_subscriptions")
    .insert({ ...sub, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function updateSubscription(
  id: string,
  updates: Partial<Omit<Subscription, "id" | "created_at" | "user_id">>
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Subscription>(
      "subscription.update",
      { ...updates, id, version: await mainVersion("subscriptions", id) },
      "subscriptions"
    );
  }
  if (isDemoModeRoute()) return demoUpdateSubscription(id, updates);
  const { data, error } = await supabase
    .from("money_subscriptions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function deleteSubscription(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("subscription.delete", {
      id,
      version: await mainVersion("subscriptions", id),
    });
  }
  if (isDemoModeRoute()) {
    demoDeleteSubscription(id);
    return;
  }
  const { error } = await supabase.from("money_subscriptions").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Dividends                                                         */
/* ================================================================== */

export async function getDividends() {
  if (isAuthenticatedMainApp()) return (await getMainData()).dividends;
  const { data, error } = await supabase
    .from("money_dividends")
    .select("*")
    .order("date", { ascending: false });
  if (error) {
    return [] as Dividend[];
  }
  return data as Dividend[];
}

export async function createDividend(div: Omit<Dividend, "id" | "created_at" | "user_id">) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Dividend>("dividend.create", { ...div }, "dividends");
  }
  if (isDemoModeRoute()) return demoCreateDividend({ ...div, reinvested: div.reinvested ?? false });
  const { data, error } = await supabase
    .from("money_dividends")
    .insert({ ...div, reinvested: div.reinvested ?? false, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as Dividend;
}

export async function updateDividend(
  id: string,
  updates: Partial<Omit<Dividend, "id" | "created_at" | "user_id">>
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<Dividend>(
      "dividend.update",
      { ...updates, id, version: await mainVersion("dividends", id) },
      "dividends"
    );
  }
  if (isDemoModeRoute()) return demoUpdateDividend(id, updates);
  const { data, error } = await supabase
    .from("money_dividends")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Dividend;
}

export async function deleteDividend(id: string) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("dividend.delete", { id, version: await mainVersion("dividends", id) });
  }
  if (isDemoModeRoute()) {
    demoDeleteDividend(id);
    return;
  }
  const { error } = await supabase.from("money_dividends").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Credit Cards                                                      */
/* ================================================================== */

export async function getCreditCards() {
  if (isAuthenticatedMainApp()) return (await getMainData()).creditCards;
  const { data, error } = await supabase
    .from("money_credit_cards")
    .select("*")
    .order("archived", { ascending: true })
    .order("position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    return [] as CreditCard[];
  }
  return data as CreditCard[];
}

export async function reorderAccounts(
  ids: string[],
  observed?: Array<{ id: string; version?: number }>
) {
  if (ids.length === 0) return;
  if (isAuthenticatedMainApp()) {
    if (!observed || observed.length !== ids.length)
      throw new Error("Refresh before changing the order.");
    return mainCommand("ordering.set", {
      kind: "bank",
      items: ids.map((id) => ({ id, version: observed.find((row) => row.id === id)?.version })),
    });
  }
  if (ids.length === 0) return;
  if (isDemoModeRoute()) return;
  // Per-row UPDATE keeps RLS happy (upsert can trip the INSERT path which
  // expects user_id and other NOT NULL fields the reorder payload omits).
  const results = await Promise.all(
    ids.map((id, i) => supabase.from("money_accounts").update({ position: i }).eq("id", id))
  );
  const failure = results.find((r) => r.error);
  if (failure?.error) throw failure.error;
}

export async function reorderCreditCards(
  ids: string[],
  observed?: Array<{ id: string; version?: number }>
) {
  if (ids.length === 0) return;
  if (isAuthenticatedMainApp()) {
    if (!observed || observed.length !== ids.length)
      throw new Error("Refresh before changing the order.");
    return mainCommand("ordering.set", {
      kind: "card",
      items: ids.map((id) => ({ id, version: observed.find((row) => row.id === id)?.version })),
    });
  }
  if (ids.length === 0) return;
  if (isDemoModeRoute()) return;
  const results = await Promise.all(
    ids.map((id, i) => supabase.from("money_credit_cards").update({ position: i }).eq("id", id))
  );
  const failure = results.find((r) => r.error);
  if (failure?.error) throw failure.error;
}

export async function createCreditCard(
  card: Omit<CreditCard, "id" | "created_at" | "user_id" | "position" | "color" | "archived"> & {
    position?: number | null;
    color?: string | null;
    archived?: boolean;
  }
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<CreditCard>("card.create", { ...card }, "creditCards");
  }
  const normalized = {
    ...card,
    position: card.position ?? null,
    color: card.color ?? null,
    archived: card.archived ?? false,
  };
  if (isDemoModeRoute()) return demoCreateCreditCard(normalized);
  const { data, error } = await supabase
    .from("money_credit_cards")
    .insert({ ...normalized, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export async function updateCreditCard(
  id: string,
  updates: Partial<Omit<CreditCard, "id" | "created_at" | "user_id">>,
  observedVersion?: number
) {
  if (isAuthenticatedMainApp())
    return mainCommandRow<CreditCard>(
      "card.update",
      { id, ...updates, version: observedVersion ?? (await mainVersion("creditCards", id)) },
      "creditCards"
    );
  if (isDemoModeRoute()) return demoUpdateCreditCard(id, updates);
  const { data, error } = await supabase
    .from("money_credit_cards")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export interface CardRemovalPreview {
  id: string;
  version: number;
  previewToken: string;
  name: string;
  trackedBalance: string | null;
  reconciliationNeeded: boolean;
  charges: number;
  linkedExpenses: number;
  payments: number;
  bankPayments: number;
  snapshots: number;
  pdfImports: number;
  subscriptions: number;
}

export async function getCardRemovalPreview(id: string): Promise<CardRemovalPreview> {
  const response = await fetch(`/api/workspace/card-removal?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load card removal details.");
  const counts = [
    "charges",
    "linkedExpenses",
    "payments",
    "bankPayments",
    "snapshots",
    "pdfImports",
    "subscriptions",
  ];
  if (
    body.id !== id ||
    !Number.isInteger(body.version) ||
    typeof body.previewToken !== "string" ||
    !body.previewToken ||
    typeof body.name !== "string" ||
    (body.trackedBalance !== null &&
      (typeof body.trackedBalance !== "string" || !/^\d+\.\d{2}$/.test(body.trackedBalance))) ||
    typeof body.reconciliationNeeded !== "boolean" ||
    counts.some((key) => !Number.isInteger(body[key]) || body[key] < 0)
  ) {
    throw new Error("Card removal details are incomplete. Reload the preview before continuing.");
  }
  return body as CardRemovalPreview;
}

export async function deleteCreditCard(
  id: string,
  version?: number,
  permanent?: {
    mode: "permanent";
    confirmation_name: string;
    preview_token: string;
  }
) {
  if (isAuthenticatedMainApp()) {
    return mainCommand("card.delete", {
      id,
      version: version ?? (await mainVersion("creditCards", id)),
      ...permanent,
    });
  }
  if (isDemoModeRoute()) {
    demoDeleteCreditCard(id);
    return;
  }
  const { error } = await supabase.from("money_credit_cards").delete().eq("id", id);
  if (error) throw error;
}

/* ================================================================== */
/*  Credit Card Charges                                               */
/* ================================================================== */

export async function getCreditCardCharges() {
  if (isAuthenticatedMainApp()) return (await getMainData()).creditCardCharges;
  const { data, error } = await supabase
    .from("money_credit_card_charges")
    .select("*")
    .order("date", { ascending: false });
  if (error) {
    return [] as CreditCardCharge[];
  }
  return data as CreditCardCharge[];
}

export async function createCreditCardCharge(
  charge: Omit<CreditCardCharge, "id" | "created_at" | "user_id">
) {
  if (isAuthenticatedMainApp()) {
    const { linked_transaction_id, ...input } = charge;
    if (linked_transaction_id) return unavailableMainMutation();
    return mainCommandRow<CreditCardCharge>(
      "card.charge",
      { ...input, version: await mainVersion("creditCards", charge.card_id) },
      "creditCardCharges"
    );
  }
  if (isDemoModeRoute()) return demoCreateCreditCardCharge(charge);
  const { data, error } = await supabase
    .from("money_credit_card_charges")
    .insert({ ...charge, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as CreditCardCharge;
}

/** Create a CC charge AND its linked expense transaction in one shot. */
export async function createLinkedCreditCardCharge(
  charge: Omit<CreditCardCharge, "id" | "created_at" | "user_id" | "linked_transaction_id">,
  txOverrides: {
    currency: CurrencyCode;
    cardName: string;
    exclude_from_monthly?: boolean;
    personal_share_percent?: number;
    shared_with?: string | null;
    goal_id?: string | null;
    is_recurring?: boolean;
    recurrence?: string | null;
  }
) {
  if (isAuthenticatedMainApp()) {
    return mainCommandRow<CreditCardCharge>(
      "card.charge",
      {
        ...charge,
        tx_overrides: txOverrides,
        version: await mainVersion("creditCards", charge.card_id),
      },
      "creditCardCharges"
    );
  }
  if (isDemoModeRoute()) {
    const recurring = txOverrides.is_recurring ?? false;
    const tx = demoCreateTransaction({
      exclude_from_monthly: txOverrides.exclude_from_monthly ?? false,
      personal_share_percent: txOverrides.personal_share_percent ?? 100,
      shared_with: txOverrides.shared_with ?? null,
      goal_id: txOverrides.goal_id ?? null,
      type: "expense",
      date: charge.date,
      amount: charge.amount,
      currency: txOverrides.currency,
      category: charge.category ?? null,
      account_id: null,
      from_account_id: null,
      to_account_id: null,
      merchant: charge.merchant ?? null,
      notes: charge.notes
        ? `CC: ${txOverrides.cardName} — ${charge.notes}`
        : `CC: ${txOverrides.cardName}`,
      is_recurring: recurring,
      recurrence: recurring
        ? ((txOverrides.recurrence as import("./database.types").RecurrenceFrequency) ?? null)
        : null,
    });
    const ccCharge = demoCreateCreditCardCharge({ ...charge, linked_transaction_id: tx.id });
    demoUpdateTransaction(tx.id, { linked_charge_id: ccCharge.id });
    return ccCharge;
  }
  const recurring = txOverrides.is_recurring ?? false;
  // 1. Create the expense transaction first
  const tx = await createTransaction({
    exclude_from_monthly: txOverrides.exclude_from_monthly ?? false,
    personal_share_percent: txOverrides.personal_share_percent ?? 100,
    shared_with: txOverrides.shared_with ?? null,
    goal_id: txOverrides.goal_id ?? null,
    type: "expense",
    date: charge.date,
    amount: charge.amount,
    currency: txOverrides.currency,
    category: charge.category ?? null,
    account_id: null,
    from_account_id: null,
    to_account_id: null,
    merchant: charge.merchant ?? null,
    notes: charge.notes
      ? `CC: ${txOverrides.cardName} — ${charge.notes}`
      : `CC: ${txOverrides.cardName}`,
    is_recurring: recurring,
    recurrence: recurring
      ? ((txOverrides.recurrence as import("./database.types").RecurrenceFrequency) ?? null)
      : null,
    linked_charge_id: null, // will be updated after charge is created
  });
  // 2. Create the charge with back-link
  const { data, error } = await supabase
    .from("money_credit_card_charges")
    .insert({ ...charge, linked_transaction_id: tx.id, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  const ccCharge = data as CreditCardCharge;
  // 3. Update transaction with forward-link
  await supabase
    .from("money_transactions")
    .update({ linked_charge_id: ccCharge.id })
    .eq("id", tx.id);
  return ccCharge;
}

export async function deleteCreditCardCharge(id: string) {
  if (isAuthenticatedMainApp()) {
    return unavailableMainMutation();
  }
  if (isDemoModeRoute()) {
    demoDeleteCreditCardCharge(id);
    return;
  }
  // Also delete linked expense transaction if one exists
  const { data: charge } = await supabase
    .from("money_credit_card_charges")
    .select("linked_transaction_id")
    .eq("id", id)
    .single();
  if (charge?.linked_transaction_id) {
    // Clear back-link first to avoid loops
    await supabase
      .from("money_transactions")
      .update({ linked_charge_id: null })
      .eq("id", charge.linked_transaction_id);
    await supabase.from("money_transactions").delete().eq("id", charge.linked_transaction_id);
  }
  const { error } = await supabase.from("money_credit_card_charges").delete().eq("id", id);
  if (error) throw error;
}

export async function updateCreditCardCharge(
  id: string,
  updates: Partial<Omit<CreditCardCharge, "id" | "created_at" | "user_id">>
) {
  if (isAuthenticatedMainApp()) {
    return unavailableMainMutation();
  }
  if (isDemoModeRoute()) return demoUpdateCreditCardCharge(id, updates);
  const { data, error } = await supabase
    .from("money_credit_card_charges")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const charge = data as CreditCardCharge;
  // Sync changes to linked expense transaction if one exists
  if (charge.linked_transaction_id) {
    const txUpdates: Record<string, unknown> = {};
    if (updates.date !== undefined) txUpdates.date = updates.date;
    if (updates.amount !== undefined) txUpdates.amount = updates.amount;
    if (updates.merchant !== undefined) txUpdates.merchant = updates.merchant;
    if (updates.category !== undefined) txUpdates.category = updates.category;
    if (Object.keys(txUpdates).length > 0) {
      await supabase
        .from("money_transactions")
        .update(txUpdates)
        .eq("id", charge.linked_transaction_id);
    }
  }
  return charge;
}

/* ================================================================== */
/*  Credit Card Payments                                              */
/* ================================================================== */

export async function getCreditCardPayments() {
  if (isAuthenticatedMainApp()) return (await getMainData()).creditCardPayments;
  const { data, error } = await supabase
    .from("money_credit_card_payments")
    .select("*")
    .order("date", { ascending: false });
  if (error) {
    return [] as CreditCardPayment[];
  }
  return data as CreditCardPayment[];
}

export async function createCreditCardPayment(
  payment: Omit<CreditCardPayment, "id" | "created_at" | "user_id">
) {
  if (isAuthenticatedMainApp()) {
    const { refund_of_transaction_id, ...input } = payment;
    if (refund_of_transaction_id) return unavailableMainMutation();
    return mainCommandRow<CreditCardPayment>(
      "card.payment",
      { ...input, version: await mainVersion("creditCards", payment.card_id) },
      "creditCardPayments"
    );
  }
  if (isDemoModeRoute()) return demoCreateCreditCardPayment(payment);
  const { data, error } = await supabase
    .from("money_credit_card_payments")
    .insert({ ...payment, user_id: OWNER_ID })
    .select()
    .single();
  if (error) throw error;
  return data as CreditCardPayment;
}

export async function updateCreditCardPayment(
  id: string,
  updates: Partial<Omit<CreditCardPayment, "id" | "created_at" | "user_id">>
) {
  if (isAuthenticatedMainApp()) {
    return unavailableMainMutation();
  }
  if (isDemoModeRoute()) {
    const s = (await import("./demo-store")).getDemoStore();
    const idx = s.creditCardPayments.findIndex((p) => p.id === id);
    if (idx >= 0) {
      validateRefund(
        { ...s.creditCardPayments[idx], ...updates },
        s.transactions,
        s.creditCardPayments,
        s.creditCardCharges
      );
      Object.assign(s.creditCardPayments[idx], updates);
      (await import("./demo-store")).refreshDemoRefunds();
    }
    return;
  }
  const { error } = await supabase.from("money_credit_card_payments").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteCreditCardPayment(id: string) {
  if (isAuthenticatedMainApp()) {
    return unavailableMainMutation();
  }
  if (isDemoModeRoute()) {
    demoDeleteCreditCardPayment(id);
    return;
  }
  const { error } = await supabase.from("money_credit_card_payments").delete().eq("id", id);
  if (error) throw error;
}

/** Compute the outstanding balance on a credit card:
 *  Sum of charges - Sum of payments */
export function computeCreditCardBalance(
  cardId: string,
  charges: CreditCardCharge[],
  payments: CreditCardPayment[],
  card?: { tracked_balance?: string | null }
): number {
  if (card && Object.prototype.hasOwnProperty.call(card, "tracked_balance")) {
    const tracked = Number(card.tracked_balance ?? 0);
    return Number.isFinite(tracked) ? tracked : 0;
  }
  const totalCharges = charges
    .filter((c) => c.card_id === cardId)
    .reduce((s, c) => s + c.amount, 0);
  const totalPayments = payments
    .filter((p) => p.card_id === cardId)
    .reduce((s, p) => s + p.amount, 0);
  const bal = totalCharges - totalPayments;
  return Math.abs(bal) < 0.005 ? 0 : Math.round(bal * 100) / 100;
}

/** Compute pending payments from a specific account (sum of cc payments from that account) */
export function computePendingCreditCardPayments(
  accountId: string,
  charges: CreditCardCharge[],
  payments: CreditCardPayment[],
  creditCards: CreditCard[]
): number {
  // Sum of outstanding balances on cards linked to this account
  let pending = 0;
  for (const card of creditCards) {
    if (card.linked_account_id === accountId) {
      const bal = computeCreditCardBalance(card.id, charges, payments);
      if (bal > 0) pending += bal;
    }
  }
  return pending;
}

/* ================================================================== */
/*  Net Worth Snapshots                                               */
/* ================================================================== */

export async function getNetWorthSnapshots(): Promise<NetWorthSnapshot[]> {
  if (isAuthenticatedMainApp()) return (await getMainData()).netWorthSnapshots;
  const { data, error } = await supabase
    .from("money_net_worth_snapshots")
    .select("*")
    .order("date", { ascending: true });
  if (error) return [] as NetWorthSnapshot[];
  return data as NetWorthSnapshot[];
}
