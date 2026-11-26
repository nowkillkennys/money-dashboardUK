"use client";
import { MoneyShell } from "../../components/money-shell";
import { CreditCardsContent } from "../../credit-cards/credit-cards-content";
export default function DemoDebtsPage() {
  return (
    <MoneyShell demoMode routeBase="/demo">
      <div className="mb-5">
        <h1 className="text-3xl font-semibold">All Debts</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Synthetic demo credit accounts. The private dashboard also supports loans, catalogue
          credit and buy now, pay later accounts.
        </p>
      </div>
      <CreditCardsContent />
    </MoneyShell>
  );
}
