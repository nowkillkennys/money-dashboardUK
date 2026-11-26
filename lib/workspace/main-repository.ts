import { paymentEditFields, executePaymentEditCommand } from "./main-payment-edit";
import { chargeEditFields, executeChargeEditCommand } from "./main-charge-edit";
import {
  executeSubscriptionPaymentCommand,
  subscriptionPaymentFields,
} from "./main-subscription-payments";
import { deleteMainCard } from "./main-card-deletion";
import { orderingFields, executeOrderingCommand } from "./main-ordering";
import { goalFields, executeGoalCommand } from "./main-goals";
import { preferenceFields, executePreferenceCommand } from "./main-preferences";
import { investmentFields, executeInvestmentCommand } from "./main-investments";
import { londonCivilDate } from "../money/uk-locale";
import { createHash, randomUUID } from "node:crypto";
import { withUserDb } from "./db";
import { HttpError } from "./http";
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new HttpError(400, "Invalid identifier");
  return value;
}
function plain(row: any): any {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v instanceof Date
        ? ["date", "target_date", "next_billing"].includes(k)
          ? v.toISOString().slice(0, 10)
          : v.toISOString()
        : v,
    ])
  );
}
const tables = [
  "money_accounts",
  "money_transactions",
  "money_goals",
  "money_goal_accounts",
  "money_allocation_plans",
  "money_settings",
  "money_holdings",
  "money_subscriptions",
  "money_dividends",
  "money_credit_cards",
  "money_credit_card_charges",
  "money_credit_card_payments",
  "money_net_worth_snapshots",
] as const;
export function readMainTable(owner: string, table: string): Promise<any[]> {
  if (!tables.includes(table as any)) throw new HttpError(400, "Unsupported table");
  return withUserDb(owner, async (c) =>
    (await c.query(`SELECT * FROM ${table} ORDER BY created_at,id`)).rows.map(plain)
  );
}
function canonical(v: any): string {
  return v && typeof v === "object"
    ? Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
    : JSON.stringify(v);
}
function money(v: unknown, fallback?: number): string {
  if (v === undefined && fallback !== undefined) return fallback.toFixed(2);
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(v)))
    throw new HttpError(400, "Enter a non-negative amount with at most two decimal places");
  return String(v);
}
function date(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    throw new HttpError(400, "Invalid date");
  return v;
}
function name(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 80) throw new HttpError(400, "Enter a name");
  return v.trim();
}
export function readMainDataTables(owner: string): Promise<Record<string, any[]>> {
  return withUserDb(
    owner,
    async (c) => {
      const fields = tables
        .map(
          (t) =>
            `'${t}',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at,id) FROM ${t} r),'[]'::jsonb)`
        )
        .join(",");
      const result = (await c.query(`SELECT jsonb_build_object(${fields}) AS data`)).rows[0].data;
      return result;
    },
    true
  );
}
export async function executeMainCommand(
  owner: string,
  key: string,
  input: Record<string, any>
): Promise<{ id: string; version: number; row: any }> {
  const common = ["action", "id", "version", "currency"];
  const allowed: Record<string, string[]> = {
    charge: chargeEditFields,
    payment: paymentEditFields,
    ...orderingFields,
    ...goalFields,
    ...preferenceFields,
    ...investmentFields,
    bank: ["name", "type", "starting_balance", "position", "color", "archived"],
    transaction: [
      "type",
      "date",
      "amount",
      "account_id",
      "from_account_id",
      "to_account_id",
      "merchant",
      "category",
      "notes",
      "is_recurring",
      "exclude_from_monthly",
      "personal_share_percent",
      "shared_with",
      "goal_id",
      "recurrence",
      "idempotency_key",
      "received_amount",
    ],
    card: [
      "mode",
      "confirmation_name",
      "preview_token",
      "name",
      "credit_limit",
      "linked_account_id",
      "position",
      "color",
      "archived",
      "starting_balance",
      "opening_balance",
      "as_of",
      "card_id",
      "date",
      "amount",
      "merchant",
      "category",
      "notes",
      "account_id",
      "tx_overrides",
    ],
  };
  if (input.action === "subscription.pay") allowed.subscription = subscriptionPaymentFields;
  const category = typeof input.action === "string" ? input.action.split(".")[0] : "";
  if (!Object.prototype.hasOwnProperty.call(allowed, category))
    throw new HttpError(400, "Unsupported command");
  if (Object.keys(input).some((k) => ![...common, ...(allowed[category] ?? [])].includes(k)))
    throw new HttpError(400, "Unknown command field");
  if (
    Object.keys(input).some((k) =>
      [
        "user_id",
        "owner_id",
        "created_at",
        "linked_charge_id",
        "linked_transaction_id",
        "workspace_payment_id",
        "statement_disposition",
      ].includes(k)
    )
  )
    throw new HttpError(400, "Server-owned field");
  if (
    input.action !== "card.delete" &&
    ["mode", "confirmation_name", "preview_token"].some((field) => field in input)
  )
    throw new HttpError(400, "Removal fields require a card delete command");
  id(key);
  const fingerprint = createHash("sha256").update(canonical(input)).digest("hex");
  return withUserDb(owner, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [owner + key]);
    const prior = (await c.query("SELECT * FROM money_command_receipts WHERE key=$1", [key]))
      .rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new HttpError(409, "Request key already used");
      return prior.result;
    }
    await c.query("INSERT INTO workspace_features(owner_id) VALUES($1) ON CONFLICT DO NOTHING", [
      owner,
    ]);
    const flags = (await c.query("SELECT manual FROM workspace_features FOR UPDATE")).rows[0];
    if (!flags.manual) throw new HttpError(403, "Manual input is disabled");
    if (input.currency && input.currency !== "GBP")
      throw new HttpError(400, "This workspace uses GBP");
    const extension =
      (await executeChargeEditCommand(c, owner, input)) ??
      (await executePaymentEditCommand(c, owner, input)) ??
      (await executeSubscriptionPaymentCommand(c, owner, input)) ??
      (await executeGoalCommand(c, owner, input)) ??
      (await executePreferenceCommand(c, owner, input)) ??
      (await executeInvestmentCommand(c, owner, input)) ??
      (await executeOrderingCommand(c, owner, input));
    if (extension) {
      const result = {
        id: extension.id,
        version: extension.version,
        row: plain(extension.row ?? extension),
      };
      await c.query(
        "INSERT INTO money_command_receipts(user_id,key,fingerprint,result) VALUES($1,$2,$3,$4)",
        [owner, key, fingerprint, JSON.stringify(result)]
      );
      return result;
    }
    const [entity, action] = String(input.action).split(".");
    const table =
      entity === "bank"
        ? "money_accounts"
        : entity === "transaction"
          ? "money_transactions"
          : entity === "card"
            ? "money_credit_cards"
            : null;
    if (!table) throw new HttpError(400, "Unsupported command");
    let row: any;
    let resourceId = action === "create" ? randomUUID() : id(input.id ?? input.card_id);
    if (action !== "create" && action !== "adopt") {
      if (entity === "card")
        await c.query("SELECT id FROM workspace_accounts WHERE id=$1 FOR UPDATE", [resourceId]);
      row = (await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [resourceId])).rows[0];
      if (!row) throw new HttpError(404, "Record not found");
      if (input.version !== row.version)
        throw new HttpError(409, "Record changed. Reload before saving");
    }
    if (
      entity === "transaction" &&
      row?.preserved_card_payment &&
      ["update", "delete"].includes(action)
    )
      throw new HttpError(409, "Preserved card payment records cannot be edited or deleted");
    async function insert(t: string, fields: Record<string, any>) {
      const f = { id: randomUUID(), user_id: owner, ...fields };
      const cols = Object.keys(f);
      return (
        await c.query(
          `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
          Object.values(f)
        )
      ).rows[0];
    }
    if (entity === "card" && action === "adopt") {
      const anchor = (
        await c.query("SELECT * FROM workspace_accounts WHERE id=$1 FOR UPDATE", [resourceId])
      ).rows[0];
      if (!anchor || anchor.kind !== "credit_card")
        throw new HttpError(404, "Card statement not found");
      if (anchor.version !== input.version)
        throw new HttpError(409, "Card statement changed. Reload before linking");
      row = await insert("money_credit_cards", {
        id: resourceId,
        name: anchor.name,
        currency: "GBP",
        credit_limit: 0,
        version: anchor.version,
      });
      await c.query(
        "INSERT INTO money_workspace_cards(user_id,card_id,workspace_account_id) VALUES($1,$2,$2)",
        [owner, resourceId]
      );
    } else if (entity === "bank" && (action === "create" || action === "update")) {
      const fields = {
        name: name(input.name ?? row?.name),
        type: input.type ?? row?.type ?? "checking",
        currency: "GBP",
        starting_balance: money(input.starting_balance ?? row?.starting_balance, 0),
        color: input.color ?? row?.color ?? null,
        archived: input.archived ?? row?.archived ?? false,
        position: input.position ?? row?.position ?? null,
      };
      if (action === "create") row = await insert(table, { ...fields, id: resourceId });
      else {
        const cols = Object.keys(fields);
        row = (
          await c.query(
            `UPDATE ${table} SET ${cols.map((k, i) => k + "=$" + (i + 2)).join(",")},version=version+1 WHERE id=$1 RETURNING *`,
            [resourceId, ...Object.values(fields)]
          )
        ).rows[0];
      }
    } else if (entity === "transaction" && (action === "create" || action === "update")) {
      const type = input.type ?? row?.type;
      if (!["income", "expense", "transfer"].includes(type))
        throw new HttpError(400, "Unsupported transaction type");
      if (row?.linked_charge_id)
        throw new HttpError(400, "Linked card charges require a card command");
      const fields: any = {
        type,
        amount: money(input.amount ?? row?.amount),
        date: date(input.date ?? row?.date?.toISOString?.().slice(0, 10) ?? row?.date),
        currency: "GBP",
        account_id: null,
        from_account_id: null,
        to_account_id: null,
        merchant: input.merchant !== undefined ? input.merchant : (row?.merchant ?? null),
        category: input.category !== undefined ? input.category : (row?.category ?? null),
        notes: input.notes !== undefined ? input.notes : (row?.notes ?? null),
        exclude_from_monthly:
          input.exclude_from_monthly !== undefined
            ? input.exclude_from_monthly
            : (row?.exclude_from_monthly ?? false),
        is_recurring:
          input.is_recurring !== undefined ? input.is_recurring : (row?.is_recurring ?? false),
        recurrence: input.recurrence !== undefined ? input.recurrence : (row?.recurrence ?? null),
        personal_share_percent:
          input.personal_share_percent !== undefined
            ? input.personal_share_percent
            : (row?.personal_share_percent ?? 100),
        shared_with:
          input.shared_with !== undefined ? input.shared_with : (row?.shared_with ?? null),
        goal_id:
          input.goal_id === undefined
            ? (row?.goal_id ?? null)
            : input.goal_id
              ? id(input.goal_id)
              : null,
        received_amount:
          input.received_amount === undefined
            ? (row?.received_amount ?? null)
            : input.received_amount === null
              ? null
              : money(input.received_amount),
      };
      if (type === "transfer") {
        if (
          fields.received_amount !== null &&
          Math.round(Number(fields.received_amount) * 100) !==
            Math.round(Number(fields.amount) * 100)
        )
          throw new HttpError(400, "GBP transfers must preserve the amount between accounts");
        fields.from_account_id = id(input.from_account_id ?? row?.from_account_id);
        fields.to_account_id = id(input.to_account_id ?? row?.to_account_id);
        if (fields.from_account_id === fields.to_account_id)
          throw new HttpError(400, "Choose different accounts");
      } else fields.account_id = id(input.account_id ?? row?.account_id);
      if (action === "create") row = await insert(table, { ...fields, id: resourceId });
      else {
        const cols = Object.keys(fields);
        row = (
          await c.query(
            `UPDATE ${table} SET ${cols.map((k, i) => k + "=$" + (i + 2)).join(",")},version=version+1 WHERE id=$1 RETURNING *`,
            [resourceId, ...Object.values(fields)]
          )
        ).rows[0];
      }
    } else if (entity === "card" && action === "update") {
      const fields = {
        name: name(input.name ?? row.name),
        credit_limit: money(input.credit_limit ?? row.credit_limit),
        linked_account_id:
          input.linked_account_id === null
            ? null
            : input.linked_account_id
              ? id(input.linked_account_id)
              : row.linked_account_id,
        color: input.color ?? row.color,
        archived: input.archived ?? row.archived,
        position: input.position ?? row.position,
      };
      const cols = Object.keys(fields);
      row = (
        await c.query(
          `UPDATE money_credit_cards SET ${cols.map((k, i) => k + "=$" + (i + 2)).join(",")},version=version+1 WHERE id=$1 RETURNING *`,
          [resourceId, ...Object.values(fields)]
        )
      ).rows[0];
      await c.query("UPDATE workspace_accounts SET name=$2,version=version+1 WHERE id=$1", [
        resourceId,
        row.name,
      ]);
    } else if (entity === "card" && action === "create") {
      row = await insert(table, {
        id: resourceId,
        name: name(input.name),
        currency: "GBP",
        credit_limit: money(input.credit_limit, 0),
        linked_account_id: input.linked_account_id ? id(input.linked_account_id) : null,
        color: input.color ?? null,
      });
      await c.query(
        "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,$3,'credit_card',$4,$5)",
        [
          resourceId,
          owner,
          row.name,
          Math.round(Number(money(input.starting_balance ?? input.opening_balance, 0)) * 100),
          input.as_of === undefined ? londonCivilDate() : date(input.as_of),
        ]
      );
      await c.query(
        "INSERT INTO workspace_snapshots(id,owner_id,account_id,amount_minor,as_of,source) SELECT $1,owner_id,id,reported_minor,as_of,'manual' FROM workspace_accounts WHERE id=$2",
        [randomUUID(), resourceId]
      );
      await c.query(
        "INSERT INTO money_workspace_cards(user_id,card_id,workspace_account_id) VALUES($1,$2,$2)",
        [owner, resourceId]
      );
    } else if (entity === "card" && ["charge", "payment"].includes(action)) {
      const anchor = (
        await c.query("SELECT version FROM workspace_accounts WHERE id=$1 FOR UPDATE", [resourceId])
      ).rows[0];
      if (anchor && anchor.version !== input.version)
        throw new HttpError(409, "Card statement changed. Reload before saving");
      const amount = money(input.amount);
      if (Number(amount) <= 0) throw new HttpError(400, "Enter a positive amount");
      if (action === "charge") {
        const charge = await insert("money_credit_card_charges", {
          card_id: resourceId,
          amount,
          date: date(input.date),
          merchant: input.merchant !== undefined ? input.merchant : (row?.merchant ?? null),
          category: input.category !== undefined ? input.category : (row?.category ?? null),
          notes: input.notes !== undefined ? input.notes : (row?.notes ?? null),
        });
        if (input.tx_overrides !== undefined) {
          if (
            !input.tx_overrides ||
            typeof input.tx_overrides !== "object" ||
            Array.isArray(input.tx_overrides)
          )
            throw new HttpError(400, "Invalid transaction details");
          const overrides = input.tx_overrides;
          const allowedOverrides = [
            "currency",
            "cardName",
            "category",
            "exclude_from_monthly",
            "personal_share_percent",
            "shared_with",
            "goal_id",
            "is_recurring",
            "recurrence",
          ];
          if (Object.keys(overrides).some((k) => !allowedOverrides.includes(k)))
            throw new HttpError(400, "Unknown linked transaction field");
          if (overrides.currency !== undefined && overrides.currency !== "GBP")
            throw new HttpError(400, "This workspace uses GBP");
          if (overrides.is_recurring !== undefined && typeof overrides.is_recurring !== "boolean")
            throw new HttpError(400, "Invalid recurrence");
          if (
            overrides.exclude_from_monthly !== undefined &&
            typeof overrides.exclude_from_monthly !== "boolean"
          )
            throw new HttpError(400, "Invalid reporting setting");
          if (
            overrides.recurrence != null &&
            !["weekly", "bi-weekly", "monthly", "yearly"].includes(overrides.recurrence)
          )
            throw new HttpError(400, "Invalid recurrence");
          if (overrides.is_recurring && !overrides.recurrence)
            throw new HttpError(400, "Recurring expenses require a frequency");
          if (
            overrides.personal_share_percent !== undefined &&
            (!/^\d{1,3}(?:\.\d{1,2})?$/.test(String(overrides.personal_share_percent)) ||
              Number(overrides.personal_share_percent) > 100)
          )
            throw new HttpError(400, "Invalid personal share");
          const tx = await insert("money_transactions", {
            type: "expense",
            amount,
            date: date(input.date),
            currency: "GBP",
            category: input.tx_overrides?.category ?? input.category ?? null,
            merchant: input.merchant !== undefined ? input.merchant : (row?.merchant ?? null),
            notes: input.notes !== undefined ? input.notes : (row?.notes ?? null),
            linked_charge_id: charge.id,
            exclude_from_monthly: input.tx_overrides?.exclude_from_monthly ?? false,
            personal_share_percent: input.tx_overrides?.personal_share_percent ?? 100,
            shared_with: input.tx_overrides?.shared_with ?? null,
            goal_id: overrides.goal_id ? id(overrides.goal_id) : null,
            is_recurring: overrides.is_recurring ?? false,
            recurrence: overrides.is_recurring ? overrides.recurrence : null,
          });
          await c.query(
            "UPDATE money_credit_card_charges SET linked_transaction_id=$1 WHERE id=$2",
            [tx.id, charge.id]
          );
          row = { ...charge, linked_transaction_id: tx.id };
        } else row = charge;
      } else {
        const paymentId = randomUUID();
        if (anchor)
          await c.query(
            "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,$4,'posted','excluded',$5)",
            [paymentId, owner, resourceId, Math.round(Number(amount) * 100), date(input.date)]
          );
        row = await insert("money_credit_card_payments", {
          id: paymentId,
          card_id: resourceId,
          account_id: input.account_id ? id(input.account_id) : null,
          amount,
          date: date(input.date),
          notes: input.notes !== undefined ? input.notes : (row?.notes ?? null),
          workspace_payment_id: anchor ? paymentId : null,
        });
      }
      if (anchor) {
        const balance = (
          await c.query(
            `SELECT a.reported_minor + COALESCE((SELECT sum(amount*100) FROM money_credit_card_charges WHERE card_id=a.id AND statement_disposition='excluded'),0) - COALESCE((SELECT sum(amount_minor) FROM workspace_payments WHERE account_id=a.id AND status='posted' AND disposition='excluded'),0) AS minor FROM workspace_accounts a WHERE a.id=$1`,
            [resourceId]
          )
        ).rows[0];
        if (Number(balance.minor) < 0)
          throw new HttpError(400, "Payment exceeds the tracked card balance");
        await c.query("UPDATE workspace_accounts SET version=version+1 WHERE id=$1", [resourceId]);
      }
      await c.query("UPDATE money_credit_cards SET version=version+1 WHERE id=$1", [resourceId]);
      // The same workspace identity is an explicit statement anchor; canonical charge/payment rows are the live ledger.
      row.version = Number(input.version) + 1;
    } else if (action === "delete" && entity === "card") {
      const permanent = input.mode === "permanent";
      const fields = permanent
        ? ["action", "id", "version", "mode", "confirmation_name", "preview_token"]
        : ["action", "id", "version"];
      if (Object.keys(input).some((k) => !fields.includes(k)))
        throw new HttpError(400, "Delete accepts only the card identifier and version");
      if (
        permanent &&
        (typeof input.confirmation_name !== "string" ||
          typeof input.preview_token !== "string" ||
          !/^[a-f0-9]{64}$/.test(input.preview_token))
      )
        throw new HttpError(400, "A current preview and exact card name are required");
      row = await deleteMainCard(
        c,
        owner,
        row,
        permanent
          ? { confirmation_name: input.confirmation_name, preview_token: input.preview_token }
          : undefined
      );
    } else if (action === "delete" && entity !== "card") {
      if (entity === "bank") {
        const references = (
          await c.query(
            `SELECT EXISTS(SELECT 1 FROM money_transactions WHERE account_id=$1 OR from_account_id=$1 OR to_account_id=$1 UNION ALL SELECT 1 FROM money_credit_card_payments WHERE account_id=$1 UNION ALL SELECT 1 FROM money_credit_cards WHERE linked_account_id=$1 UNION ALL SELECT 1 FROM money_goals WHERE linked_account_id=$1 UNION ALL SELECT 1 FROM money_goal_accounts WHERE account_id=$1 UNION ALL SELECT 1 FROM money_holdings WHERE account_id=$1 UNION ALL SELECT 1 FROM money_subscriptions WHERE lower(payment_account_id)=$1::text UNION ALL SELECT 1 FROM money_reconciliation_sessions WHERE account_id=$1) AS present`,
            [resourceId]
          )
        ).rows[0];
        if (references.present)
          throw new HttpError(
            409,
            "Archive accounts with financial history instead of deleting them"
          );
      }
      if (entity === "transaction" && row.linked_charge_id)
        throw new HttpError(400, "Linked charges cannot be deleted independently");
      await c.query(`DELETE FROM ${table} WHERE id=$1`, [resourceId]);
      row = { ...row, version: row.version + 1 };
    } else throw new HttpError(400, "Unsupported command");
    const result = { id: row.id, version: row.version, row: plain(row) };
    await c.query(
      "INSERT INTO money_command_receipts(user_id,key,fingerprint,result) VALUES($1,$2,$3,$4)",
      [owner, key, fingerprint, JSON.stringify(result)]
    );
    return result;
  });
}
