import type { PoolClient } from "pg";
import { HttpError } from "./http";
import { withUserDb } from "./db";
import { id, readDebtAccounts } from "./ledger";

/** Called inside the command receipt transaction after owner/feature/version gates. */
export async function deleteMainCard(
  c: PoolClient,
  owner: string,
  row: any,
  permanent?: { confirmation_name: string; preview_token: string }
): Promise<any> {
  if (row.user_id !== owner) throw new HttpError(404, "Record not found");
  try {
    // The database independently verifies the session owner and all deletion
    // invariants without granting general DELETE access to statement history.
    const result = permanent
      ? await c.query("SELECT public.permanently_delete_main_card($1,$2,$3,$4) AS row", [
          row.id,
          row.version,
          permanent.confirmation_name,
          permanent.preview_token,
        ])
      : await c.query("SELECT public.delete_unused_main_card($1,$2) AS row", [row.id, row.version]);
    return result.rows[0].row;
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const status =
      failure.code === "22023"
        ? 400
        : failure.code === "P0002"
          ? 404
          : failure.code === "P0001"
            ? 409
            : failure.code === "42501"
              ? 403
              : null;
    if (status) throw new HttpError(status, failure.message ?? "Card could not be deleted");
    throw error;
  }
}

/** Consistent owner-only preview; the SQL digest is rechecked inside deletion. */
export async function previewMainCardRemoval(owner: string, cardId: string) {
  id(cardId);
  return withUserDb(
    owner,
    async (c) => {
      const { state, token } = (
        await c.query(
          `SELECT state, encode(sha256(convert_to(state::text,'UTF8')),'hex') AS token FROM (SELECT public.main_card_removal_state($1) AS state) s`,
          [cardId]
        )
      ).rows[0];
      if (!state.card) throw new HttpError(404, "Record not found");
      const debt = (await readDebtAccounts(c)).find((d) => d.id === cardId);
      if (!debt) throw new HttpError(409, "Card statement identity is missing");
      return {
        id: state.card.id,
        version: state.card.version,
        name: state.card.name,
        trackedBalance: debt.trackedBalance,
        reconciliationNeeded: debt.reconciliationNeeded,
        charges: state.charges.length,
        linkedExpenses: state.expenses.length,
        payments: new Set([
          ...state.payments.map((p: any) => p.workspace_payment_id ?? p.id),
          ...state.workspacePayments.map((p: any) => p.id),
        ]).size,
        bankPayments: state.payments.filter((p: any) => p.account_id !== null).length,
        snapshots: state.snapshots.length,
        pdfImports: state.pdfImports.length,
        subscriptions: state.subscriptions.length,
        previewToken: token,
      };
    },
    true
  );
}
