import type { CurrencyCode } from "./database.types";
import { fetchYahooQuotes, type QuoteResult } from "./yahoo-finance";

import { convertCurrency, type FxRates } from "./fx";
import { DEMO_FX } from "./uk-locale";
export type { FxRates } from "./fx";
export type { QuoteResult as StockQuote };

let cachedFx: { rates: FxRates; expiresAt: number } | null = null;
let cachedStocks: { quotes: Record<string, QuoteResult>; expiresAt: number } | null = null;

export async function getServerFxRates(): Promise<FxRates> {
  if (process.env.UK_DEMO_ONLY === "true") return DEMO_FX;
  if (cachedFx && Date.now() < cachedFx.expiresAt) return cachedFx.rates;

  try {
    const data = await fetchYahooQuotes(["USDCAD=X", "USDEGP=X", "USDGBP=X", "USDEUR=X"]);
    const rates: FxRates = {
      USDCAD: data["USDCAD=X"]?.price || 1,
      USDEGP: data["USDEGP=X"]?.price || 1,
      USDGBP: data["USDGBP=X"]?.price || 1,
      USDEUR: data["USDEUR=X"]?.price || 1,
    };
    cachedFx = { rates, expiresAt: Date.now() + 30 * 60 * 1000 };
    return rates;
  } catch (err) {
    console.error("Failed to fetch FX rates from Yahoo:", err);
  }

  return { USDCAD: 1, USDEGP: 1 };
}

export async function getStockQuotes(symbols: string[]): Promise<Record<string, QuoteResult>> {
  if (process.env.UK_DEMO_ONLY === "true") return {};
  if (symbols.length === 0) return {};

  const key = [...symbols].sort().join(",");
  if (cachedStocks && Date.now() < cachedStocks.expiresAt) {
    if (symbols.every((s) => s in cachedStocks!.quotes)) return cachedStocks.quotes;
  }

  try {
    const quotes = await fetchYahooQuotes(symbols);
    cachedStocks = { quotes, expiresAt: Date.now() + 15 * 60 * 1000 };
    return quotes;
  } catch (err) {
    console.error("Failed to fetch stock quotes from Yahoo:", err);
  }

  return {};
}

export function convertToBase(
  amount: number,
  from: CurrencyCode,
  baseCurrency: CurrencyCode,
  fx: FxRates
): number {
  return convertCurrency(amount, from, baseCurrency, fx);
}
