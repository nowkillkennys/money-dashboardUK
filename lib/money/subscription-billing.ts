import type { RecurrenceFrequency } from "./database.types";

/** Strict Gregorian civil day, independent of the host timezone. */
export function subscriptionCivilDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith("0000-")
  )
    throw new Error("Invalid date");
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error("Invalid date");
  return value;
}

/** Advance one scheduled cycle. Monthly/yearly dates clamp in the destination month. */
export function advanceSubscriptionBilling(
  current: string,
  frequency: RecurrenceFrequency
): string {
  subscriptionCivilDate(current);
  const d = new Date(current + "T00:00:00Z");
  if (frequency === "weekly" || frequency === "bi-weekly") {
    d.setUTCDate(d.getUTCDate() + (frequency === "weekly" ? 7 : 14));
  } else if (frequency === "monthly" || frequency === "yearly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (frequency === "monthly" ? 1 : 12));
    const end = new Date(d);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    d.setUTCDate(Math.min(day, end.getUTCDate()));
  } else throw new Error("Invalid frequency");
  if (d.getUTCFullYear() > 9999) throw new Error("Date exceeds supported calendar");
  return subscriptionCivilDate(d.toISOString().slice(0, 10));
}
