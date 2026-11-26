import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withUserDb } from "./db";
import { HttpError } from "./http";
import { parseMoneyMinor, formatMoneyDecimal } from "../debt/money";
import { deriveDebtBalance } from "../debt/reconciliation";
export const kinds = ["credit_card", "loan", "catalogue", "bnpl", "monthly_fee"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new HttpError(400, "Invalid identifier");
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "Invalid date");
  return value;
}
function amount(value: unknown) {
  try {
    if (typeof value !== "string") throw Error();
    return parseMoneyMinor(value);
  } catch {
    throw new HttpError(400, "Use a non-negative GBP amount with at most two decimal places");
  }
}
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Unknown input field");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function readDebtAccounts(client: PoolClient) {
  const rows = (
    await client.query(
      "SELECT id,name,kind,reported_minor,as_of::text,version,review_required FROM workspace_accounts ORDER BY name,id"
    )
  ).rows;
  const links = (
    await client.query("SELECT card_id,workspace_account_id FROM money_workspace_cards")
  ).rows;
  const charges = (
    await client.query(
      "SELECT id,card_id,amount::text,date::text,statement_disposition AS disposition FROM money_credit_card_charges ORDER BY date,id"
    )
  ).rows;
  const snapshots = (
    await client.query(
      "SELECT account_id,amount_minor,as_of::text,source,observations,created_at,payment_dispositions FROM workspace_snapshots ORDER BY created_at DESC,id DESC"
    )
  ).rows;
  const payments = (
    await client.query(
      "SELECT id,account_id,amount_minor,status,disposition,paid_on::text FROM workspace_payments ORDER BY paid_on,id"
    )
  ).rows;
  return rows.map((a) => {
    const ps = payments
      .filter((p) => p.account_id === a.id)
      .map((p) => ({
        id: p.id,
        amount: formatMoneyDecimal(Number(p.amount_minor)),
        status: p.status,
        disposition: p.disposition,
        paidOn: p.paid_on,
      }));
    const cs = charges.filter((c) => c.card_id === a.id);
    const excludedCharges = cs
      .filter((c) => c.disposition === "excluded")
      .reduce((sum, c) => sum + parseMoneyMinor(c.amount), 0);
    const derived = a.review_required
      ? {
          reportedBalance: formatMoneyDecimal(Number(a.reported_minor)),
          trackedBalance: null,
          reconciliationNeeded: true,
          pendingTotal: formatMoneyDecimal(
            ps
              .filter((p) => p.status === "pending")
              .reduce((sum, p) => sum + parseMoneyMinor(p.amount), 0)
          ),
        }
      : deriveDebtBalance(
          formatMoneyDecimal(Number(a.reported_minor) + excludedCharges),
          ps,
          ps
            .filter((p) => p.status === "posted")
            .map((p) => ({ paymentId: p.id, disposition: p.disposition }))
        );
    const unknownCharge = cs.some((c) => c.disposition === "unresolved");
    return {
      ...a,
      reported_minor: undefined,
      asOf: a.as_of,
      ...derived,
      reportedBalance: formatMoneyDecimal(Number(a.reported_minor)),
      trackedBalance: unknownCharge ? null : derived.trackedBalance,
      reconciliationNeeded: unknownCharge || derived.reconciliationNeeded,
      charges: cs,
      mainCardLinked: links.some((link) => link.workspace_account_id === a.id),
      payments: ps,
      snapshots: snapshots
        .filter((s) => s.account_id === a.id)
        .map((s) => ({
          ...s,
          amount: formatMoneyDecimal(Number(s.amount_minor)),
          amount_minor: undefined,
        })),
    };
  });
}
export function listAccounts(owner: string) {
  return withUserDb(owner, readDebtAccounts);
}
export async function executeCommand(
  owner: string,
  key: string,
  input: Record<string, unknown>
): Promise<{ id: string }> {
  id(key);
  if (input.action === "create" && input.kind === "credit_card") {
    keys(input, ["action", "name", "kind", "amount", "asOf"]);
    const { executeMainCommand } = await import("./main-repository");
    const result = await executeMainCommand(owner, key, {
      action: "card.create",
      name: input.name,
      currency: "GBP",
      credit_limit: "0",
      starting_balance: input.amount,
      as_of: input.asOf,
    });
    return { id: result.id };
  }
  if (input.action === "link_card") {
    keys(input, ["action", "accountId", "version"]);
    const { executeMainCommand } = await import("./main-repository");
    const result = await executeMainCommand(owner, key, {
      action: "card.adopt",
      id: input.accountId,
      version: input.version,
    });
    return { id: result.id };
  }
  const fingerprint = createHash("sha256").update(canonical(input)).digest("hex");
  return withUserDb(owner, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [owner + key]);
    const prior = (
      await client.query("SELECT fingerprint,result FROM workspace_command_receipts WHERE key=$1", [
        key,
      ])
    ).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new HttpError(409, "This request key has already been used for a different change");
      return prior.result;
    }
    await client.query(
      "INSERT INTO workspace_features(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
      [owner]
    );
    const flags = (await client.query("SELECT manual,pdf FROM workspace_features FOR UPDATE"))
      .rows[0];
    if (!(input.previewId ? flags.pdf : flags.manual))
      throw new HttpError(403, "This input method is disabled");
    let accountId: string;
    let observations: unknown = null;
    if (input.action === "create") {
      keys(input, ["action", "name", "kind", "amount", "asOf"]);
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.trim().length > 80 ||
        !kinds.includes(input.kind as (typeof kinds)[number])
      )
        throw new HttpError(400, "Enter an account name and supported debt type");
      accountId = randomUUID();
      await client.query(
        "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,$3,$4,$5,$6)",
        [accountId, owner, input.name.trim(), input.kind, amount(input.amount), date(input.asOf)]
      );
    } else {
      accountId = id(input.accountId);
      const row = (
        await client.query("SELECT version FROM workspace_accounts WHERE id=$1 FOR UPDATE", [
          accountId,
        ])
      ).rows[0];
      if (!row) throw new HttpError(404, "Account not found");
      if (!Number.isInteger(input.version) || input.version !== row.version)
        throw new HttpError(409, "This account changed. Reload and review before saving");
      const mapped = (
        await client.query(
          "SELECT card_id FROM money_workspace_cards WHERE workspace_account_id=$1",
          [accountId]
        )
      ).rows[0];
      if (mapped && input.action === "payment")
        throw new HttpError(
          400,
          "Record card repayments from Credit Cards and choose their bank source"
        );
      if (input.action === "payment") {
        keys(input, ["action", "accountId", "version", "amount", "status", "paidOn"]);
        const minor = amount(input.amount);
        if (minor === 0 || !["posted", "pending"].includes(String(input.status)))
          throw new HttpError(400, "Enter a positive payment and its status");
        await client.query(
          "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,$4,$5,'excluded',$6)",
          [randomUUID(), owner, accountId, minor, input.status, date(input.paidOn)]
        );
      } else if (input.action === "void") {
        keys(input, ["action", "accountId", "version", "paymentId"]);
        if (mapped) {
          const previous = (
            await client.query(
              "SELECT disposition FROM workspace_payments WHERE id=$1 AND account_id=$2",
              [id(input.paymentId), accountId]
            )
          ).rows[0];
          if (previous?.disposition === "included")
            throw new HttpError(
              409,
              "This payment is included in a reported statement. Review a corrected statement before voiding it"
            );
        }
        const r = await client.query(
          "UPDATE workspace_payments SET status='voided' WHERE id=$1 AND account_id=$2 AND status!='voided'",
          [id(input.paymentId), accountId]
        );
        await client.query("DELETE FROM money_credit_card_payments WHERE workspace_payment_id=$1", [
          id(input.paymentId),
        ]);
        if (r.rowCount !== 1) throw new HttpError(404, "Active payment not found");
      } else if (input.action === "reconcile") {
        keys(input, [
          "action",
          "accountId",
          "version",
          "amount",
          "asOf",
          "dispositions",
          "chargeDispositions",
          "previewId",
        ]);
        if (!Array.isArray(input.dispositions) || input.dispositions.length > 10000)
          throw new HttpError(400, "Classify the recorded posted payments");
        const ps = (
          await client.query(
            "SELECT id,amount_minor,status FROM workspace_payments WHERE account_id=$1 AND status='posted'",
            [accountId]
          )
        ).rows;
        if (
          input.dispositions.some(
            (d) =>
              !d ||
              typeof d !== "object" ||
              Array.isArray(d) ||
              Object.keys(d).some((k) => !["paymentId", "disposition"].includes(k)) ||
              typeof d.paymentId !== "string" ||
              typeof d.disposition !== "string"
          )
        )
          throw new HttpError(400, "Invalid payment classifications");
        const decisions = input.dispositions as { paymentId: string; disposition: string }[];
        if (
          decisions.length !== ps.length ||
          new Set(decisions.map((d) => d.paymentId)).size !== ps.length ||
          decisions.some(
            (d) =>
              !ps.some((p) => p.id === d.paymentId) ||
              !["included", "excluded", "unresolved"].includes(d.disposition)
          )
        )
          throw new HttpError(400, "Classify every posted payment exactly once");
        const charges = (
          await client.query(
            "SELECT id FROM money_credit_card_charges WHERE card_id=$1 FOR UPDATE",
            [accountId]
          )
        ).rows;
        const chargeDecisions = input.chargeDispositions ?? [];
        if (
          !Array.isArray(chargeDecisions) ||
          chargeDecisions.length !== charges.length ||
          new Set(chargeDecisions.map((d) => d?.chargeId)).size !== charges.length ||
          chargeDecisions.some(
            (d) =>
              !d ||
              !charges.some((c) => c.id === d.chargeId) ||
              !["included", "excluded", "unresolved"].includes(d.disposition)
          )
        )
          throw new HttpError(400, "Classify every card charge exactly once");
        for (const decision of chargeDecisions)
          await client.query(
            "UPDATE money_credit_card_charges SET statement_disposition=$1 WHERE id=$2",
            [decision.disposition, decision.chargeId]
          );
        const minor = amount(input.amount);
        const asOf = date(input.asOf);
        await client.query(
          "UPDATE workspace_accounts SET reported_minor=$1,as_of=$2,review_required=false WHERE id=$3",
          [minor, asOf, accountId]
        );
        for (const d of decisions)
          await client.query(
            "UPDATE workspace_payments SET disposition=$1 WHERE id=$2 AND account_id=$3",
            [d.disposition, d.paymentId, accountId]
          );
        if (input.previewId) {
          const preview = (
            await client.query(
              "SELECT id,confirmed_account_id,expires_at,parsed FROM workspace_pdf_previews WHERE id=$1 FOR UPDATE",
              [id(input.previewId)]
            )
          ).rows[0];
          if (
            !preview ||
            preview.confirmed_account_id ||
            new Date(preview.expires_at) <= new Date()
          )
            throw new HttpError(409, "Preview is expired or already confirmed");
          observations = preview.parsed;
          await client.query(
            "UPDATE workspace_pdf_previews SET confirmed_account_id=$1 WHERE id=$2",
            [accountId, preview.id]
          );
        }
      } else throw new HttpError(400, "Unknown command");
      await client.query("UPDATE workspace_accounts SET version=version+1 WHERE id=$1", [
        accountId,
      ]);
      if (mapped)
        await client.query("UPDATE money_credit_cards SET version=version+1 WHERE id=$1", [
          mapped.card_id,
        ]);
      try {
        await readDebtAccounts(client);
      } catch {
        throw new HttpError(400, "Payment classifications would make the balance invalid");
      }
    }
    if (input.action === "create" || input.action === "reconcile")
      await client.query(
        "INSERT INTO workspace_snapshots(id,owner_id,account_id,amount_minor,as_of,source,observations,payment_dispositions) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          owner,
          accountId,
          amount(input.amount),
          date(input.asOf),
          input.previewId ? "pdf" : "manual",
          observations ? JSON.stringify(observations) : null,
          JSON.stringify(input.dispositions || []),
        ]
      );
    const result = { id: accountId };
    await client.query(
      "INSERT INTO workspace_command_receipts(owner_id,key,fingerprint,result) VALUES($1,$2,$3,$4)",
      [owner, key, fingerprint, JSON.stringify(result)]
    );
    return result;
  });
}
