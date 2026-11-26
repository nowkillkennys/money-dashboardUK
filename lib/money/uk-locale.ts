import type { FxRates } from "./fx";

export const UK_LOCALE = "en-GB";
export const UK_TIME_ZONE = "Europe/London";
export const UK_BASE_CURRENCY = "GBP";
/** Illustrative, fixed demo rates: currency units per USD. Never live market data. */
export const DEMO_FX: FxRates = { USDCAD: 1.36, USDEGP: 50, USDGBP: 0.8, USDEUR: 0.92 };

export function londonCivilDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function civilDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/** Date-only values are civil calendar days, independent of a browser's time zone. */
export function offsetCivilDate(value: string, days: number): string {
  const date = civilDate(value);
  if (!date || !Number.isInteger(days)) throw new Error("Invalid civil date or day offset");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatUkDate(value: string): string {
  const date = civilDate(value);
  return date ? new Intl.DateTimeFormat(UK_LOCALE, { timeZone: "UTC" }).format(date) : "Invalid date";
}
