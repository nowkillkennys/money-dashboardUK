import type { CurrencyCode } from "./database.types";

export type FxRates = {
  /** CAD per 1 USD */
  USDCAD: number;
  /** EGP per 1 USD */
  USDEGP: number;
  /** GBP per 1 USD (optional for legacy rate fixtures). */
  USDGBP?: number;
  /** EUR per 1 USD. */
  USDEUR?: number;
};

export const DEFAULT_FX: FxRates = { USDCAD: 1, USDEGP: 1 };

function safeRate(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  fx: FxRates
): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;

  const rates: Record<CurrencyCode, number> = {
    USD: 1,
    CAD: safeRate(fx.USDCAD),
    EGP: safeRate(fx.USDEGP),
    GBP: safeRate(fx.USDGBP ?? 1),
    EUR: safeRate(fx.USDEUR ?? 1),
  };
  return (amount / rates[from]) * rates[to];
}
