import { it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  journalCommand,
  pendingMainCommands,
  retryMainCommand,
} from "../../lib/workspace/main-journal";
import { mainRunningBalance } from "../../lib/workspace/main-running-balance";
import { mainData } from "../../lib/workspace/main-data";
import { executeCommand } from "../../lib/workspace/ledger";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  other = randomUUID();
afterAll(async () => {
  await admin.query("DELETE FROM money_command_journal WHERE user_id=ANY($1::uuid[])", [
    [owner, other],
  ]);
  /* Complete synthetic ledger retained for foreign-key-safe cleanup by isolated test volume. */ await admin.end();
});
it("integrates bank/card/expense/payment/statement with one identity and one effect", async () => {
  await admin.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3),($4,$5,$3)",
    [owner, "integrated-" + owner, "disabled", other, "integrated-" + other]
  );
  const bank = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: { action: "bank.create", name: "Synthetic bank", starting_balance: "1000.00" },
  });
  const card = await journalCommand(owner, randomUUID(), {
    surface: "debt",
    input: {
      action: "create",
      name: "Synthetic card",
      kind: "credit_card",
      amount: "100.00",
      asOf: "2026-11-26",
    },
  });
  let data = await mainData(owner, "Synthetic");
  expect(data.creditCards[0].id).toBe(card.id);
  expect(data.creditCards[0].tracked_balance).toBe("100.00");
  expect(data.settings.rent_amount).toBe(0);
  await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "card.charge",
      id: card.id,
      version: 1,
      amount: "25.00",
      date: "2026-11-26",
      tx_overrides: { currency: "GBP" },
    },
  });
  const key = randomUUID(),
    payment = {
      surface: "main" as const,
      input: {
        action: "card.payment",
        id: card.id,
        version: 2,
        amount: "50.00",
        date: "2026-11-26",
        account_id: bank.id,
      },
    };
  await journalCommand(owner, key, payment);
  await retryMainCommand(owner, key);
  data = await mainData(owner, "Synthetic");
  expect(data.balances[bank.id]).toBe(950);
  expect(mainRunningBalance(data, bank.id)[0].running_balance).toBe(950);
  expect(data.creditCards[0].tracked_balance).toBe("75.00");
  expect(data.transactions.filter((t: any) => t.type === "expense")).toHaveLength(1);
  expect(data.creditCardPayments).toHaveLength(1);
  expect(await pendingMainCommands(owner)).toEqual([]);
  expect((await mainData(other, "Other")).accounts).toHaveLength(0);
  const ps = (await admin.query("SELECT id FROM workspace_payments WHERE owner_id=$1", [owner]))
    .rows;
  const cs = data.creditCardCharges;
  await executeCommand(owner, randomUUID(), {
    action: "reconcile",
    accountId: card.id,
    version: 3,
    amount: "75.00",
    asOf: "2026-11-26",
    dispositions: ps.map((p) => ({ paymentId: p.id, disposition: "included" })),
    chargeDispositions: cs.map((c: any) => ({ chargeId: c.id, disposition: "included" })),
  });
  data = await mainData(owner, "Synthetic");
  expect(data.creditCards[0].tracked_balance).toBe("75.00");
  expect(data.balances[bank.id]).toBe(950);
  await expect(
    executeCommand(owner, randomUUID(), {
      action: "void",
      accountId: card.id,
      version: 4,
      paymentId: ps[0].id,
    })
  ).rejects.toMatchObject({ status: 409 });
  const next = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "card.payment",
      id: card.id,
      version: 4,
      amount: "25.00",
      date: "2026-11-26",
      account_id: bank.id,
    },
  });
  expect((await mainData(owner, "Synthetic")).balances[bank.id]).toBe(925);
  await executeCommand(owner, randomUUID(), {
    action: "void",
    accountId: card.id,
    version: 5,
    paymentId: next.id,
  });
  data = await mainData(owner, "Synthetic");
  expect(data.balances[bank.id]).toBe(950);
  expect(data.creditCardPayments).toHaveLength(1);
  expect(data.creditCards[0].tracked_balance).toBe("75.00");
});
it("preserves native linked-charge recurrence and partial transaction fields", async () => {
  const data = await mainData(owner, "Synthetic"),
    bank = data.accounts[0],
    card = data.creditCards[0];
  const goal = randomUUID();
  await admin.query("INSERT INTO money_goals(id,user_id,name,target_amount) VALUES($1,$2,$3,100)", [
    goal,
    owner,
    "Synthetic goal",
  ]);
  const tx = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "transaction.create",
      type: "expense",
      account_id: bank.id,
      amount: "2.00",
      date: "2026-11-26",
      goal_id: goal,
    },
  });
  await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: { action: "transaction.update", id: tx.id, version: 1, notes: "Synthetic edit" },
  });
  const row = (await mainData(owner, "Synthetic")).transactions.find((x: any) => x.id === tx.id);
  expect(row.goal_id).toBe(goal);
  const charge = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "card.charge",
      id: card.id,
      version: card.version,
      amount: "5.00",
      date: "2026-11-26",
      tx_overrides: {
        currency: "GBP",
        goal_id: goal,
        is_recurring: true,
        recurrence: "monthly",
        personal_share_percent: 50,
      },
    },
  });
  const linked = (await mainData(owner, "Synthetic")).transactions.find(
    (x: any) => x.linked_charge_id === charge.id
  );
  expect(linked.is_recurring).toBe(true);
  expect(linked.recurrence).toBe("monthly");
  expect(linked.goal_id).toBe(goal);
  expect(linked.personal_share_percent).toBe(50);
});
it("preserves received amounts during partial edits and serializes civil dates across BST", async () => {
  const data = await mainData(owner, "Synthetic"),
    bank = data.accounts[0];
  const destination = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: { action: "bank.create", name: "Synthetic destination", starting_balance: "0.00" },
  });
  const transfer = await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "transaction.create",
      type: "transfer",
      from_account_id: bank.id,
      to_account_id: destination.id,
      amount: "10.00",
      received_amount: "10.00",
      date: "2026-06-01",
    },
  });
  await journalCommand(owner, randomUUID(), {
    surface: "main",
    input: {
      action: "transaction.update",
      id: transfer.id,
      version: 1,
      notes: "Synthetic transfer edit",
    },
  });
  const tx = (await mainData(owner, "Synthetic")).transactions.find(
    (t: any) => t.id === transfer.id
  );
  expect(tx.received_amount).toBe(10);
  expect(tx.date).toBe("2026-06-01");
});
