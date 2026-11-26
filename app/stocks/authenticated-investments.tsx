"use client";
import { useBalanceVisibility } from "../balance-visibility-provider";
import { useState } from "react";
import { useMoneyData } from "../hooks/use-money-data";
import { mainCommand } from "@/lib/workspace/main-client";
import { PageHeader, formatMoney } from "../components/money-ui";

export function AuthenticatedInvestments() {
  const { showBalances } = useBalanceVisibility();
  const money = (amount: number) => (showBalances ? formatMoney(amount, "GBP") : "••••");
  const data = useMoneyData(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<any>(null),
    [dividend, setDividend] = useState<any>(null);
  async function run(action: string, input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await mainCommand(action, input);
      setEditing(null);
      setDividend(null);
      await data.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change failed");
    } finally {
      setBusy(false);
    }
  }
  const accounts = data.accounts.filter((a) => a.type === "investing" && a.currency === "GBP");
  return (
    <div className="min-w-0 space-y-6 [&_button]:min-h-11 [&_button]:rounded-xl [&_button]:border [&_button]:border-[var(--border-subtle)] [&_button]:px-4 [&_button]:py-2 [&_button]:font-medium [&_button:hover]:bg-[var(--bg-elevated)] [&_button:disabled]:opacity-50 [&_label]:grid [&_label]:gap-2 [&_input]:min-w-0 [&_input]:rounded-xl [&_input]:border [&_input]:border-[var(--border-subtle)] [&_input]:bg-[var(--bg-secondary)] [&_input]:p-3 [&_select]:min-w-0 [&_select]:max-w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-[var(--border-subtle)] [&_select]:p-3 [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-4">
      <PageHeader title="Investments" description="Manual holdings, cost basis and dividend history" />
      <p className="money-surface p-5 text-sm leading-6 text-text-secondary" role="status">
        Track holdings and dividends manually. Cost basis records what you invested; live prices,
        current market values and trade settlement are not included. Changes to holdings do not move
        tracked cash. Dividend records do not add bank cash or automatically change shares, including
        when marked reinvested.
      </p>
      {(error || data.error) && <p role="alert">{error || data.error}</p>}
      <button
        disabled={busy || !accounts.length}
        onClick={() => {
          setDividend(null);
          setEditing({});
        }}
      >
        Add position
      </button>
      {!accounts.length && <p>Create a GBP investing account in Accounts first.</p>}
      {data.loading ? (
        <p>Loading investments…</p>
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr>
                <th>Position</th>
                <th>Shares</th>
                <th>Cost basis</th>
                <th>Current value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.id}>
                  <td>
                    {h.symbol}
                    <br />
                    {accounts.find((a) => a.id === h.account_id)?.name}
                  </td>
                  <td>{h.shares}</td>
                  <td>{money(Number(h.cost_basis))}</td>
                  <td>Not tracked</td>
                  <td>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setDividend(null);
                        setEditing(h);
                      }}
                    >
                      Edit
                    </button>{" "}
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setDividend({ holding_id: h.id });
                      }}
                    >
                      Record dividend
                    </button>{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        run("holding.delete", { id: h.id, version: (h as any).version })
                      }
                    >
                      Delete position
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <form
          className="money-surface grid gap-4 p-5 sm:grid-cols-2 [&_h2]:font-semibold [&_h2]:sm:col-span-2"
          key={editing.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(editing.id ? "holding.update" : "holding.create", {
              ...(editing.id ? { id: editing.id, version: editing.version } : {}),
              account_id: f.get("account_id"),
              symbol: f.get("symbol"),
              shares: f.get("shares"),
              cost_basis: f.get("cost_basis"),
              cost_currency: "GBP",
            });
          }}
        >
          <h2>{editing.id ? "Edit position" : "Add position"}</h2>
          <label>
            Account{" "}
            <select name="account_id" defaultValue={editing.account_id ?? accounts[0]?.id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Symbol{" "}
            <input name="symbol" required maxLength={32} defaultValue={editing.symbol ?? ""} />
          </label>
          <label>
            Shares{" "}
            <input name="shares" required inputMode="decimal" defaultValue={editing.shares ?? ""} />
          </label>
          <label>
            Total cost basis (GBP){" "}
            <input
              name="cost_basis"
              required
              inputMode="decimal"
              defaultValue={editing.cost_basis ?? ""}
            />
          </label>
          <button disabled={busy}>Save position</button>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
      <h2 className="text-xl font-semibold tracking-tight">Dividend history</h2>
      <div className="min-w-0 max-w-full overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr>
              <th>Position</th>
              <th>Date</th>
              <th>Amount (GBP)</th>
              <th>Reinvested</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.dividends.map((d) => (
              <tr key={d.id}>
                <td>{d.symbol}</td>
                <td>{d.date}</td>
                <td>{money(Number(d.amount))}</td>
                <td>{d.reinvested ? "Yes" : "No"}</td>
                <td>{d.notes}</td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setDividend(d);
                    }}
                  >
                    Edit
                  </button>{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("dividend.delete", { id: d.id, version: (d as any).version })
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dividend && (
        <form
          className="money-surface grid gap-4 p-5 sm:grid-cols-2 [&_h2]:font-semibold [&_h2]:sm:col-span-2"
          key={dividend.id ?? dividend.holding_id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(dividend.id ? "dividend.update" : "dividend.create", {
              ...(dividend.id ? { id: dividend.id, version: dividend.version } : {}),
              holding_id: f.get("holding_id"),
              amount: f.get("amount"),
              date: f.get("date"),
              currency: "GBP",
              notes: f.get("notes") || null,
              reinvested: f.get("reinvested") === "on",
            });
          }}
        >
          <h2>{dividend.id ? "Edit dividend" : "Record dividend"}</h2>
          <label>
            Position{" "}
            <select name="holding_id" defaultValue={dividend.holding_id}>
              {data.holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount (GBP){" "}
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={dividend.amount ?? ""}
            />
          </label>
          <label>
            Date <input name="date" type="date" required defaultValue={dividend.date ?? ""} />
          </label>
          <label>
            Notes <input name="notes" maxLength={2000} defaultValue={dividend.notes ?? ""} />
          </label>
          <label>
            <input
              name="reinvested"
              type="checkbox"
              defaultChecked={dividend.reinvested ?? false}
            />
            Reinvested (history only)
          </label>
          <button disabled={busy}>Save dividend</button>
          <button type="button" onClick={() => setDividend(null)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
