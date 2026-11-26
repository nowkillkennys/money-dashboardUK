"use client";
import { StatementObservations, type ParsedStatement } from "./statement-observations";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "../auth-provider";
import { commandKey } from "@/lib/workspace/client-id";
import { formatMoney } from "../components/money-ui";
type Payment = { id: string; amount: string; status: string; disposition: string; paidOn: string };
type Account = {
  mainCardLinked?: boolean;
  snapshots: {
    amount: string;
    as_of: string;
    source: string;
    observations: ParsedStatement | null;
    created_at: string;
  }[];
  id: string;
  name: string;
  kind: string;
  reportedBalance: string;
  trackedBalance: string | null;
  pendingTotal: string;
  asOf: string;
  version: number;
  payments: Payment[];
  charges?: { id: string; amount: string; date: string; disposition: string }[];
};
const types: Record<string, string> = {
  credit_card: "Credit card",
  loan: "Loan",
  catalogue: "Catalogue credit",
  bnpl: "Buy now, pay later",
  monthly_fee: "Monthly-fee account",
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const pounds = (amount: string) => formatMoney(Number(amount), "GBP");
class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
async function api(path: string, options?: RequestInit) {
  const r = await fetch("/api/workspace/" + path, { ...options, cache: "no-store" });
  const data = await r.json();
  if (r.status === 401) {
    window.location.replace("/");
    throw new ApiError(401, "Sign in required");
  }
  if (!r.ok) throw new ApiError(r.status, data.error || "Request failed");
  return data;
}
export function DebtWorkspace() {
  const { username, signOut } = useAuth();
  const running = useRef(false);
  const [user, setUser] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all");
  const [flags, setFlags] = useState({ manual: true, pdf: true }),
    [preview, setPreview] = useState<{
      id: string;
      parsed: ParsedStatement;
      expiresAt: string;
    } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [reported, setReported] = useState(""),
    [asOf, setAsOf] = useState(today()),
    [decisions, setDecisions] = useState<Record<string, string>>({});
  // A failed transport keeps its request key until explicit retry; edits generate a new command key.
  const [chargeDecisions, setChargeDecisions] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState<{ key: string; input: Record<string, unknown> } | null>(null);
  const active = accounts.find((a) => a.id === selected);
  async function reload() {
    const [data, features] = await Promise.all([api("accounts"), api("features")]);
    setAccounts(data.accounts);
    setFlags(features);
  }
  useEffect(() => {
    api("auth/session")
      .then(async (d) => {
        if (d.user) {
          setUser(d.user.username);
          await reload();
        }
      })
      .catch((e) => {
        if (e.message !== "Sign in required")
          setError("The workspace is unavailable. No data has been loaded.");
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    setReviewed(false);
    setPreview(null);
    setReported(active?.reportedBalance || "");
    setAsOf(active?.asOf || today());
    setChargeDecisions(
      Object.fromEntries((active?.charges || []).map((charge) => [charge.id, "unresolved"]))
    );
    setDecisions(
      Object.fromEntries(
        active?.payments.filter((p) => p.status === "posted").map((p) => [p.id, "unresolved"]) || []
      )
    );
  }, [selected, active]);
  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setError("");
    setBusy(true);
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function command(
    input: Record<string, unknown>,
    saved?: { key: string; input: Record<string, unknown> }
  ) {
    if (retry && !saved) throw new Error("Resolve the pending change before making another change");
    const change = saved || { key: commandKey(), input };
    setRetry(change);
    try {
      await api("accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": change.key },
        body: JSON.stringify(change.input),
      });
    } catch (e) {
      // A server/gateway failure can follow a committed write. Keep its key.
      if (e instanceof ApiError && e.status < 500 && e.status !== 408) setRetry(null);
      throw e;
    }
    await reload();
    setRetry(null);
  }
  if (!ready) return <div className="p-8">Loading debts…</div>;
  if (!user) return <p role="alert">Sign in required.</p>;
  const total = accounts.reduce(
    (sum, a) => sum + (a.trackedBalance === null ? 0 : Math.round(Number(a.trackedBalance) * 100)),
    0
  );
  return (
    <div className="workspace-ui">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-secondary">Money / {username || user}</p>
          <h1 className="text-3xl font-semibold">Your debts</h1>
        </div>
        <button
          disabled={busy}
          className="money-btn-secondary"
          onClick={() =>
            run(async () => {
              await signOut();
              setUser(null);
              setAccounts([]);
              setSelected("");
              setPreview(null);
              setRetry(null);
              setError("");
              setReported("");
              setDecisions({});
            })
          }
        >
          Sign out
        </button>
      </header>
      {error && (
        <p role="alert" className="my-4 rounded-xl border border-red-300 p-4">
          {error}
        </p>
      )}
      {retry && (
        <div className="my-4 rounded-xl border p-4">
          A change has not been acknowledged. Retry safely with the same request key.
          <button
            className="money-btn-secondary ml-2"
            disabled={busy}
            onClick={() => run(() => command(retry.input, retry))}
          >
            Retry change
          </button>
        </div>
      )}
      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="money-surface p-5">
          <p>Tracked debt total</p>
          <strong className="text-3xl">{pounds((total / 100).toFixed(2))}</strong>
          <p className="text-xs text-text-secondary">
            Excludes {accounts.filter((a) => a.trackedBalance === null).length} unresolved accounts.
            Not bank assets or net worth.
          </p>
        </div>
        <div className="money-surface p-5">
          <p>Accounts</p>
          <strong className="text-3xl">{accounts.length}</strong>
          <p className="text-xs">Cards, loans, catalogue credit and BNPL are each counted once.</p>
        </div>
        <div className="money-surface p-5">
          <p className="font-semibold">Input methods</p>
          {(["manual", "pdf"] as const).map((key) => (
            <label key={key} className="mt-2 block">
              <input
                type="checkbox"
                checked={flags[key]}
                disabled={busy || !!retry}
                onChange={(e) =>
                  run(async () => {
                    const next = { ...flags, [key]: e.target.checked };
                    await api("features", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(next),
                    });
                    setFlags(next);
                  })
                }
              />{" "}
              {key === "manual" ? "Manual tracking" : "PDF review"}
            </label>
          ))}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section>
          <nav aria-label="Debt groups" className="mb-4 flex gap-3">
            <button
              className="money-btn-secondary"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All debts
            </button>
            <button
              className="money-btn-secondary"
              aria-pressed={filter === "credit_card"}
              onClick={() => setFilter("credit_card")}
            >
              Credit cards
            </button>
          </nav>
          <div className="money-surface divide-y">
            {accounts
              .filter((a) => filter === "all" || a.kind === filter)
              .map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                  onClick={() => setSelected(a.id)}
                >
                  <span className="min-w-0 break-words">
                    <strong className="block">{a.name}</strong>
                    <small>{types[a.kind]}</small>
                  </span>
                  <span>
                    {a.trackedBalance === null ? "Review needed" : pounds(a.trackedBalance)}
                  </span>
                </button>
              ))}
            {!accounts.length && (
              <p className="p-5">No debt accounts yet. Add a reported balance to begin.</p>
            )}
          </div>
          <details className="money-surface mt-5 p-5">
            <summary className="cursor-pointer font-semibold">Add debt account</summary>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget,
                  v = new FormData(f);
                run(async () => {
                  await command({
                    action: "create",
                    name: v.get("name"),
                    kind: v.get("kind"),
                    amount: v.get("amount"),
                    asOf: v.get("asOf"),
                  });
                  f.reset();
                });
              }}
            >
              <label className="block">
                Account name
                <input required maxLength={80} name="name" className="money-input w-full" />
              </label>
              <label className="block">
                Debt type
                <select name="kind" className="money-input w-full">
                  {Object.entries(types).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Reported balance (£)
                <input required name="amount" inputMode="decimal" className="money-input w-full" />
              </label>
              <label className="block">
                As of
                <input
                  required
                  type="date"
                  name="asOf"
                  defaultValue={today()}
                  className="money-input w-full"
                />
              </label>
              <button className="money-btn-primary" disabled={busy || !!retry || !flags.manual}>
                Add account
              </button>
            </form>
          </details>
        </section>
        <section className="min-w-0">
          {active ? (
            <>
              <div className="money-surface p-5">
                <h2 className="text-2xl font-semibold">{active.name}</h2>
                {active.kind === "credit_card" && !active.mainCardLinked && (
                  <button
                    disabled={busy || !!retry || !flags.manual}
                    className="money-btn-secondary my-2"
                    onClick={() =>
                      run(() =>
                        command({
                          action: "link_card",
                          accountId: active.id,
                          version: active.version,
                        })
                      )
                    }
                  >
                    Connect this existing card to Credit Cards
                  </button>
                )}
                <p>{types[active.kind]} · GBP</p>
                <dl className="my-4 grid grid-cols-2 gap-3">
                  <div>
                    <dt>Reported balance</dt>
                    <dd className="text-xl">{pounds(active.reportedBalance)}</dd>
                    <small>{active.asOf}</small>
                  </div>
                  <div>
                    <dt>Tracked estimate</dt>
                    <dd className="text-xl">
                      {active.trackedBalance === null
                        ? "Review needed"
                        : pounds(active.trackedBalance)}
                    </dd>
                    <small>Pending payments: {pounds(active.pendingTotal)}</small>
                  </div>
                </dl>
                <p className="text-xs text-text-secondary">
                  {active.kind === "credit_card"
                    ? "Card payments use the Credit Cards ledger and a source bank account."
                    : "Payments affect this debt estimate only. No bank transaction is created."}{" "}
                  Interest and fees are not projected here.
                </p>
              </div>
              {active.kind === "credit_card" ? (
                <div className="money-surface mt-4 p-5">
                  <h3 className="font-semibold">Record a card payment</h3>
                  <p className="my-3 text-sm text-text-secondary">
                    Choose a source bank account in Credit Cards so the card payment and bank debit
                    are recorded together.
                  </p>
                  <a className="money-btn-primary inline-flex" href="/credit-cards">
                    Open Credit Cards
                  </a>
                </div>
              ) : (
                <details className="money-surface mt-4 p-5">
                  <summary className="font-semibold">Record a debt-only payment</summary>
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget,
                        v = new FormData(f);
                      run(async () => {
                        await command({
                          action: "payment",
                          accountId: active.id,
                          version: active.version,
                          amount: v.get("amount"),
                          status: v.get("status"),
                          paidOn: v.get("paidOn"),
                        });
                        f.reset();
                      });
                    }}
                  >
                    <label className="block">
                      Payment (£)
                      <input
                        name="amount"
                        required
                        inputMode="decimal"
                        className="money-input w-full"
                      />
                    </label>
                    <label className="block">
                      Status
                      <select name="status" className="money-input w-full">
                        <option value="posted">Posted</option>
                        <option value="pending">Pending</option>
                      </select>
                    </label>
                    <label className="block">
                      Date
                      <input
                        name="paidOn"
                        type="date"
                        defaultValue={today()}
                        required
                        className="money-input w-full"
                      />
                    </label>
                    <button
                      disabled={busy || !!retry || !flags.manual}
                      className="money-btn-primary"
                    >
                      Record payment
                    </button>
                  </form>
                </details>
              )}
              <div className="money-surface mt-4 p-5">
                <h3 className="font-semibold">Payment history</h3>
                {active.payments.map((p) => (
                  <div
                    key={p.id}
                    className="my-2 flex flex-wrap justify-between gap-2 border-b py-2"
                  >
                    <span>
                      {pounds(p.amount)} · {p.status} · {p.paidOn}
                      <small className="block">{p.disposition}</small>
                    </span>
                    {p.status !== "voided" && (
                      <button
                        disabled={busy || !!retry || !flags.manual}
                        className="underline"
                        onClick={() =>
                          run(() =>
                            command({
                              action: "void",
                              accountId: active.id,
                              version: active.version,
                              paymentId: p.id,
                            })
                          )
                        }
                      >
                        Void payment
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="money-surface mt-4 p-5">
                <details className="mb-5 border-b pb-4">
                  <summary className="font-semibold">Reported balance history</summary>
                  {active.snapshots.map((snapshot, index) => (
                    <div className="my-3 rounded-lg border p-3" key={index}>
                      <p>
                        {pounds(snapshot.amount)} · {snapshot.as_of} ·{" "}
                        {snapshot.source === "pdf" ? "Reviewed PDF" : "Manual entry"}
                      </p>
                      {snapshot.observations && (
                        <details>
                          <summary>Extracted statement observations</summary>
                          <StatementObservations parsed={snapshot.observations} />
                        </details>
                      )}
                    </div>
                  ))}
                </details>
                <h3 className="font-semibold">Review a statement balance</h3>
                <p className="my-2 text-sm">
                  Check which recorded payments and charges are already included. Dates alone do not
                  establish this.
                </p>
                <label className="my-3 block">
                  Local PDF (up to 5 MiB)
                  <input
                    aria-label="Statement PDF"
                    type="file"
                    accept="application/pdf"
                    disabled={busy || !flags.pdf}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      run(async () => {
                        const p = await api("pdf", {
                          method: "POST",
                          headers: { "Content-Type": "application/pdf" },
                          body: file,
                        });
                        setReviewed(false);
                        setPreview(p);
                        setReported(p.parsed.candidates.amount.value || "");
                        setAsOf(p.parsed.candidates.observed_on.value || "");
                      });
                      e.target.value = "";
                    }}
                    className="block w-full text-sm"
                  />
                </label>
                {preview && (
                  <div className="my-3 rounded-xl bg-bg-elevated p-3">
                    <strong>PDF preview · not saved to this account</strong>
                    <p>
                      Balance: {preview.parsed.candidates.amount.confidence}; date:{" "}
                      {preview.parsed.candidates.observed_on.confidence}. Confirm missing or
                      uncertain fields manually.
                    </p>
                    <details>
                      <summary>Extracted rates, fees and forecast observations</summary>
                      <StatementObservations parsed={preview.parsed} />
                    </details>
                    <button onClick={() => setPreview(null)} className="underline">
                      Discard preview
                    </button>
                  </div>
                )}
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await command({
                        action: "reconcile",
                        accountId: active.id,
                        version: active.version,
                        amount: reported,
                        asOf,
                        dispositions: active.payments
                          .filter((p) => p.status === "posted")
                          .map((p) => ({
                            paymentId: p.id,
                            disposition: decisions[p.id] || "unresolved",
                          })),
                        chargeDispositions: (active.charges || []).map((charge) => ({
                          chargeId: charge.id,
                          disposition: chargeDecisions[charge.id] || "unresolved",
                        })),
                        ...(preview ? { previewId: preview.id } : {}),
                      });
                      setPreview(null);
                    });
                  }}
                >
                  <label className="block">
                    New reported balance (£)
                    <input
                      required
                      value={reported}
                      onChange={(e) => {
                        setReviewed(false);
                        setReported(e.target.value);
                      }}
                      inputMode="decimal"
                      className="money-input w-full"
                    />
                  </label>
                  <label className="block">
                    Statement date
                    <input
                      required
                      type="date"
                      value={asOf}
                      onChange={(e) => {
                        setReviewed(false);
                        setAsOf(e.target.value);
                      }}
                      className="money-input w-full"
                    />
                  </label>
                  {active.payments
                    .filter((p) => p.status === "posted")
                    .map((p) => (
                      <label key={p.id} className="block">
                        {pounds(p.amount)} on {p.paidOn}
                        <select
                          aria-label={"Inclusion for " + p.id}
                          value={decisions[p.id] || "unresolved"}
                          onChange={(e) => {
                            setReviewed(false);
                            setDecisions({ ...decisions, [p.id]: e.target.value });
                          }}
                          className="money-input w-full"
                        >
                          <option value="unresolved">Unresolved — do not show an estimate</option>
                          <option value="included">Already included in reported balance</option>
                          <option value="excluded">Not included — subtract once</option>
                        </select>
                      </label>
                    ))}
                  {(active.charges || []).map((charge) => (
                    <label key={charge.id} className="block">
                      Charge {pounds(charge.amount)} on {charge.date}
                      <select
                        aria-label={"Charge inclusion for " + charge.id}
                        value={chargeDecisions[charge.id] || "unresolved"}
                        onChange={(event) => {
                          setReviewed(false);
                          setChargeDecisions({
                            ...chargeDecisions,
                            [charge.id]: event.target.value,
                          });
                        }}
                        className="money-input w-full"
                      >
                        <option value="unresolved">Unresolved — do not show an estimate</option>
                        <option value="included">Already included in reported balance</option>
                        <option value="excluded">Not included — add once</option>
                      </select>
                    </label>
                  ))}
                  <label className="block text-sm">
                    <input
                      type="checkbox"
                      required
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed the balance, date, account, payment and charge inclusion.
                  </label>
                  <button
                    disabled={busy || !!retry || !(preview ? flags.pdf : flags.manual)}
                    className="money-btn-primary"
                  >
                    Confirm reviewed balance
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="money-surface p-6">
              Select an account to review its balance, statements and payment history. Use Credit
              Cards to record card charges and payments with a source bank account.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
