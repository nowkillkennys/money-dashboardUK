"use client";

import { useRef, useState } from "react";
import { londonCivilDate, offsetCivilDate } from "@/lib/money/uk-locale";
import { useMoneyData } from "../hooks/use-money-data";
import { PageHeader, formatMoney, HIDDEN_BALANCE } from "../components/money-ui";
import { useBalanceVisibility } from "../balance-visibility-provider";
import { Loader2, Scale, Trash2, Merge, CheckCircle, AlertTriangle } from "lucide-react";
import { getMainData, mainCommand, mainVersion } from "@/lib/workspace/main-client";
import type { CurrencyCode, DuplicateCandidate } from "@/lib/money/database.types";

interface ReconcileResult {
  session: { id: string; version: number; expected_balance: string | null };
  account_version: number;
  computed_balance: number;
  delta: number | null;
  duplicates: (DuplicateCandidate & { version_a: number; version_b: number })[];
}

export function ReconcileContent() {
  const { accounts, loading, error } = useMoneyData();
  const eligibleAccounts = accounts.filter(
    (account) => !account.archived && account.currency === "GBP"
  );
  const { showBalances } = useBalanceVisibility();

  const [selectedAccount, setSelectedAccount] = useState("");
  const [dateFrom, setDateFrom] = useState(() => offsetCivilDate(londonCivilDate(), -30));
  const [dateTo, setDateTo] = useState(() => londonCivilDate());
  const [expectedBalance, setExpectedBalance] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [duplicates, setDuplicates] = useState<ReconcileResult["duplicates"]>([]);
  const [searched, setSearched] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const pendingGuard = useRef(false);
  const acct = eligibleAccounts.find((a) => a.id === selectedAccount);
  const currency: CurrencyCode = acct?.currency ?? "GBP";
  const m = (v: number) => (showBalances ? formatMoney(v, currency) : HIDDEN_BALANCE);

  const [dupActionRunning, setDupActionRunning] = useState(false);
  const applyResult = (data: ReconcileResult) => {
    setResult(data);
    setDuplicates(data.duplicates);
    setSearched(true);
  };
  const handleReconcile = async () => {
    if (!acct || error || pendingGuard.current) return;
    pendingGuard.current = true;
    setRunning(true);
    setActionMsg("");
    try {
      const response = await mainCommand("reconciliation.start", {
        account_id: selectedAccount,
        account_version: await mainVersion("accounts", selectedAccount),
        date_from: dateFrom,
        date_to: dateTo,
        expected_balance: expectedBalance === "" ? null : expectedBalance,
      });
      applyResult((response as unknown as { row: ReconcileResult }).row);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Reconciliation failed");
    } finally {
      pendingGuard.current = false;
      setRunning(false);
    }
  };
  const handleDupAction = async (actionType: "merge" | "delete" | "keep_both", txIds: string[]) => {
    if (!result || pendingGuard.current) return;
    if (
      actionType !== "keep_both" &&
      !window.confirm(
        actionType === "merge"
          ? "Keep entry A and permanently delete entry B? Amounts will not be added together. Removing an expense increases the balance; removing income decreases it by B's amount."
          : "Permanently delete entry B? Removing an expense increases the account balance; removing income decreases it by this amount."
      )
    )
      return;
    const versions: Record<string, number> = {};
    for (const id of txIds) {
      const pair = duplicates.find((d) => d.tx_a_id === id || d.tx_b_id === id);
      if (!pair) return;
      versions[id] = pair.tx_a_id === id ? pair.version_a : pair.version_b;
    }
    pendingGuard.current = true;
    setDupActionRunning(true);
    setActionMsg("");
    try {
      const response = await mainCommand("reconciliation.action", {
        id: result.session.id,
        version: result.session.version,
        account_version: result.account_version,
        action_type: actionType,
        tx_ids: txIds,
        transaction_versions: versions,
        ...(actionType === "merge" ? { keep_id: txIds[0] } : {}),
        ...(actionType === "delete" ? { delete_id: txIds[1] } : {}),
      });
      applyResult((response as unknown as { row: ReconcileResult }).row);
      setActionMsg(`Action "${actionType}" applied successfully.`);
      try {
        // Update cached bank versions before another search, as well as the session preview.
        await getMainData();
        const preview = await fetch(`/api/workspace/reconciliation?session_id=${result.session.id}`, {
          cache: "no-store",
        });
        const data = await preview.json();
        if (!preview.ok) throw new Error("Could not refresh reconciliation");
        applyResult(data);
      } catch {
        setActionMsg("Action saved. Reload the page to refresh balances and reconciliation results.");
      }
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Action failed");
    } finally {
      pendingGuard.current = false;
      setDupActionRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent-purple" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Compare balances and detect duplicate transactions"
      />

      <div className="space-y-6">
        {error && <p role="alert">{error}</p>}
        {!error && eligibleAccounts.length === 0 && (
          <p role="status">
            Create or unarchive a GBP account in Accounts to reconcile its transactions.
          </p>
        )}
        <section className="rounded-2xl border border-border-subtle bg-bg-secondary p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-text-primary">
            <Scale className="h-4 w-4 text-accent-purple" />
            Reconcile Account
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                className="mb-1 block text-xs font-medium text-text-secondary"
                htmlFor="reconcile-field-1"
              >
                Account
              </label>
              <select
                value={selectedAccount}
                disabled={running || dupActionRunning || !!error}
                onChange={(e) => {
                  setSelectedAccount(e.target.value);
                  setResult(null);
                  setDuplicates([]);
                  setSearched(false);
                }}
                className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-purple"
                id="reconcile-field-1"
              >
                <option value="">Select account...</option>
                {eligibleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-text-secondary"
                htmlFor="reconcile-field-2"
              >
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                disabled={running || dupActionRunning}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setResult(null);
                  setDuplicates([]);
                  setSearched(false);
                }}
                className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-purple"
                id="reconcile-field-2"
              />
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-text-secondary"
                htmlFor="reconcile-field-3"
              >
                To
              </label>
              <input
                type="date"
                value={dateTo}
                disabled={running || dupActionRunning}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setResult(null);
                  setDuplicates([]);
                  setSearched(false);
                }}
                className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-purple"
                id="reconcile-field-3"
              />
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-text-secondary"
                htmlFor="reconcile-field-4"
              >
                Expected Balance (optional)
              </label>
              <input
                type="number"
                step="0.01"
                value={expectedBalance}
                disabled={running || dupActionRunning}
                onChange={(e) => {
                  setExpectedBalance(e.target.value);
                  setResult(null);
                  setDuplicates([]);
                  setSearched(false);
                }}
                placeholder="From bank statement"
                className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-purple"
                id="reconcile-field-4"
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleReconcile}
              disabled={!acct || !!error || running || dupActionRunning}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-purple px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Scale className="h-4 w-4" />
              )}
              Reconcile & Find Duplicates
            </button>
          </div>
        </section>

        {result && (
          <section className="rounded-2xl border border-border-subtle bg-bg-secondary p-6">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Balance Check</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
                <p className="text-xs text-text-secondary">Computed Balance</p>
                <p className="mt-1 text-lg font-bold text-text-primary">
                  {m(result.computed_balance)}
                </p>
              </div>
              {result.delta !== null && (
                <>
                  <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
                    <p className="text-xs text-text-secondary">Expected Balance</p>
                    <p className="mt-1 text-lg font-bold text-text-primary">
                      {m(Number(result.session.expected_balance))}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border p-4 ${
                      Math.abs(result.delta) < 0.01
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-yellow-500/30 bg-yellow-500/5"
                    }`}
                  >
                    <p className="text-xs text-text-secondary">Delta</p>
                    <p
                      className={`mt-1 text-lg font-bold ${
                        Math.abs(result.delta) < 0.01 ? "text-emerald-400" : "text-yellow-400"
                      }`}
                    >
                      {Math.abs(result.delta) < 0.01 ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" /> Balanced
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" /> {m(result.delta)}
                        </span>
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {actionMsg && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 px-4 py-3 text-sm text-accent-blue"
          >
            {actionMsg}
          </div>
        )}

        <p className="text-xs text-text-secondary">
          Balances include all activity through the To date. Duplicate checks use the selected date
          range and ordinary bank income and expenses; linked card entries, repayments, transfers
          and refunds are protected.
        </p>

        {duplicates.length > 0 && (
          <section className="rounded-2xl border border-border-subtle bg-bg-secondary p-6">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">
              Potential Duplicates ({duplicates.length})
            </h3>
            <div className="space-y-3">
              {duplicates.map((dup, i) => (
                <div key={i} className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 text-xs">
                      <p className="font-medium text-text-primary">
                        Amount: {m(dup.amount)} &middot; Score: {dup.score}/100
                      </p>
                      <p className="text-text-secondary">
                        A: {dup.date_a} &mdash; {dup.merchant_a || "(no merchant)"}
                      </p>
                      <p className="text-text-secondary">
                        B: {dup.date_b} &mdash; {dup.merchant_b || "(no merchant)"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDupAction("merge", [dup.tx_a_id, dup.tx_b_id])}
                        disabled={dupActionRunning || running}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent-purple/10 px-2.5 py-1.5 text-xs font-medium text-accent-purple transition hover:bg-accent-purple/20 disabled:opacity-50"
                        title="Keep first, delete second"
                      >
                        <Merge className="h-3 w-3" /> Merge
                      </button>
                      <button
                        onClick={() => handleDupAction("delete", [dup.tx_a_id, dup.tx_b_id])}
                        disabled={dupActionRunning || running}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                        title="Delete duplicate B"
                      >
                        <Trash2 className="h-3 w-3" /> Delete B
                      </button>
                      <button
                        onClick={() => handleDupAction("keep_both", [dup.tx_a_id, dup.tx_b_id])}
                        disabled={dupActionRunning || running}
                        className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-secondary disabled:opacity-50"
                        title="Keep both"
                      >
                        <CheckCircle className="h-3 w-3" /> Keep Both
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {duplicates.length === 0 && !running && searched && (
          <p className="text-sm text-text-secondary">
            No duplicate transactions found for the selected range.
          </p>
        )}
      </div>
    </>
  );
}
