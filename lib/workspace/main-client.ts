import { commandKey } from "./client-id";
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
  NetWorthSnapshot,
} from "@/lib/money/database.types";

export interface MainData {
  accounts: Account[];
  transactions: Transaction[];
  goals: Goal[];
  goalAccounts: GoalAccount[];
  plans: AllocationPlan[];
  settings: Settings | null;
  holdings: Holding[];
  subscriptions: Subscription[];
  dividends: Dividend[];
  creditCards: CreditCard[];
  creditCardCharges: CreditCardCharge[];
  creditCardPayments: CreditCardPayment[];
  netWorthSnapshots: NetWorthSnapshot[];
  balances: Record<string, number>;
  otherDebtTotal: number;
  unresolvedDebtCount: number;
}
type CommandResult = { id: string; version: number };
type Pending = {
  key: string;
  action: string;
  body?: Record<string, unknown>;
  signature?: string;
  promise?: Promise<CommandResult>;
};
let pending: Pending | undefined;
let read: Promise<MainData> | undefined;
let latest: MainData | undefined;
let generation = 0;
let hydration: Promise<void> | undefined;
let hydrated = false;

export function isAuthenticatedMainApp() {
  return (
    process.env.NEXT_PUBLIC_AUTHENTICATED_APP === "true" &&
    !(typeof window !== "undefined" && window.location.pathname.startsWith("/demo"))
  );
}
export function clearMainSession() {
  generation++;
  hydrated = false;
  hydration = undefined;
  pending = undefined;
  latest = undefined;
  read = undefined;
  notify();
}
function requireCurrentSession(response: Response) {
  if (response.status !== 401) return;
  clearMainSession();
  if (typeof window !== "undefined") window.location.replace("/");
  throw new Error("Please sign in again.");
}
function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("main-command-state"));
}
export function getPendingMainCommands() {
  return pending ? [{ key: pending.key, action: pending.action, inFlight: !!pending.promise }] : [];
}
export const getPendingCommands = getPendingMainCommands;
export async function hydratePendingMainCommands(): Promise<void> {
  if (hydrated || pending) return;
  if (hydration) return hydration;
  const epoch = generation;
  const request = (async () => {
    const response = await fetch("/api/workspace/main-commands", {
      credentials: "same-origin",
      cache: "no-store",
    });
    requireCurrentSession(response);
    if (!response.ok)
      throw new Error("Unable to check pending changes. Please retry loading your workspace.");
    const result = (await response.json()) as { pending: Array<{ key: string; action: string }> };
    if (epoch !== generation) throw new Error("Session changed. Please reload.");
    if (!Array.isArray(result.pending)) throw new Error("Unable to check pending changes.");
    const recovered = result.pending[0];
    if (recovered && !pending) {
      if (typeof recovered.key !== "string" || typeof recovered.action !== "string")
        throw new Error("Unable to check pending changes.");
      pending = { key: recovered.key, action: recovered.action };
      notify();
    }
    hydrated = true;
  })();
  hydration = request;
  try {
    await request;
  } finally {
    if (hydration === request) hydration = undefined;
  }
}
export async function getMainData(): Promise<MainData> {
  if (read) return read;
  const epoch = generation;
  const request = (async () => {
    await hydratePendingMainCommands();
    if (epoch !== generation) throw new Error("Session changed. Please reload.");
    const response = await fetch("/api/workspace/main-data", {
      credentials: "same-origin",
      cache: "no-store",
    });
    requireCurrentSession(response);
    if (!response.ok)
      throw new Error(
        response.status === 401 ? "Please sign in again." : "Unable to load your workspace."
      );
    const result = (await response.json()) as MainData;
    if (epoch !== generation) throw new Error("Session changed. Please reload.");
    latest = result;
    return result;
  })();
  read = request;
  try {
    return await request;
  } finally {
    if (read === request) read = undefined;
  }
}
export async function mainVersion(collection: keyof MainData, id: string) {
  const data = latest ?? (await getMainData());
  const rows = data[collection];
  const row = Array.isArray(rows)
    ? (rows.find((value: { id?: string }) => value.id === id) as { version?: number } | undefined)
    : undefined;
  if (!row || !Number.isInteger(row.version))
    throw new Error("This item is out of date. Refresh before editing.");
  return row.version!;
}
async function send(command: Pending): Promise<CommandResult> {
  const epoch = generation;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        command.body ? "/api/workspace/main-commands" : "/api/workspace/main-commands/retry",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": command.key },
          body: JSON.stringify(command.body ?? { key: command.key }),
        }
      );
      requireCurrentSession(response);
      if (epoch !== generation) throw new Error("Session changed. Please reload.");
      if (response.status === 408 || response.status >= 500) {
        if (!attempt) continue;
        throw new Error(
          "The result is unknown. Retry the pending change before making another change."
        );
      }
      if (!response.ok) {
        if (pending === command) {
          pending = undefined;
          notify();
        }
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Change rejected. Refresh your workspace and try again.");
      }
      const result = (await response.json()) as CommandResult;
      if (pending === command) {
        pending = undefined;
        latest = undefined;
        notify();
      }
      return result;
    } catch (error) {
      if (epoch !== generation || pending !== command) throw error;
      if (!attempt) continue;
      throw new Error(
        "The result is unknown. Retry the pending change before making another change."
      );
    }
  }
  throw new Error("Unable to confirm change.");
}
export function resolvePendingMainCommand(): Promise<CommandResult> {
  const command = pending;
  if (!command) return Promise.reject(new Error("There is no pending change."));
  if (command.promise) return command.promise;
  command.promise = send(command).finally(() => {
    command.promise = undefined;
    notify();
  });
  notify();
  return command.promise;
}
export function mainCommand(
  action: string,
  input: Record<string, unknown>
): Promise<CommandResult> {
  const signature = JSON.stringify({ ...input, action });
  const body = JSON.parse(signature) as Record<string, unknown>;
  if (pending) {
    if (pending.signature === signature) return resolvePendingMainCommand();
    return Promise.reject(new Error("Retry the pending change before making another change."));
  }
  pending = { key: commandKey(), action, body, signature };
  return resolvePendingMainCommand();
}
export async function mainCommandRow<T>(
  action: string,
  input: Record<string, unknown>,
  collection: keyof MainData
): Promise<T> {
  const result = await mainCommand(action, input);
  const data = await getMainData();
  const rows = data[collection];
  const row = Array.isArray(rows)
    ? rows.find((value: { id?: string }) => value.id === result.id)
    : undefined;
  if (!row) throw new Error("Change saved. Refresh to see the updated item.");
  return row as T;
}
export function unavailableMainMutation(): never {
  throw new Error("This change is not yet available in the authenticated workspace.");
}
