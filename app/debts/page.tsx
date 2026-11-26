"use client";
import { MoneyShell } from "../components/money-shell";
import { DebtWorkspace } from "../workspace/debt-workspace";
export default function DebtsPage() {
  return (
    <MoneyShell>
      <DebtWorkspace />
    </MoneyShell>
  );
}
