/** Convert a non-negative database-sized decimal amount to integer pence. */
export function parseMoneyMinor(value: string): number {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid amount");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
/** Format integer pence as a canonical decimal amount. */
export function formatMoneyDecimal(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999999999)
    throw new Error("Invalid amount");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
