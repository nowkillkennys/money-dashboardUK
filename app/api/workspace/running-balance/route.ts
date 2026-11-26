import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { mainData } from "@/lib/workspace/main-data";
import { mainRunningBalance } from "@/lib/workspace/main-running-balance";
import { id } from "@/lib/workspace/ledger";
import { jsonError, HttpError } from "@/lib/workspace/http";
export async function GET(r: Request) {
  try {
    const user = await requireWorkspaceSession(r),
      url = new URL(r.url),
      account = id(url.searchParams.get("account_id"));
    for (const key of ["date_from", "date_to"]) {
      const value = url.searchParams.get(key);
      if (value && !/^\d{4}-\d\d-\d\d$/.test(value))
        throw new HttpError(400, "Invalid date filter");
    }
    const all = mainRunningBalance(await mainData(user.id, user.username), account),
      from = url.searchParams.get("date_from"),
      to = url.searchParams.get("date_to");
    return NextResponse.json(
      { transactions: all.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return jsonError(e);
  }
}
