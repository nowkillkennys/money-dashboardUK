import type { PoolClient } from "pg";
import { HttpError } from "./http";

/** Called inside the command receipt transaction after owner/feature/version gates. */
export async function deleteMainCard(c: PoolClient, owner: string, row: any): Promise<any> {
  if (row.user_id !== owner) throw new HttpError(404, "Record not found");
  try {
    // The database independently verifies the session owner and all deletion
    // invariants without granting general DELETE access to statement history.
    const result = await c.query("SELECT public.delete_unused_main_card($1,$2) AS row", [
      row.id,
      row.version,
    ]);
    return result.rows[0].row;
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const status =
      failure.code === "P0002"
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
