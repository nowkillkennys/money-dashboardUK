import { expect, it } from "vitest";
import { advanceSubscriptionBilling } from "../lib/money/subscription-billing";
it("advances exactly one civil cycle with month-end and leap-year clamping", () => {
  expect(advanceSubscriptionBilling("2026-01-31", "monthly")).toBe("2026-02-28");
  expect(advanceSubscriptionBilling("2024-02-29", "yearly")).toBe("2025-02-28");
  expect(advanceSubscriptionBilling("0099-12-29", "weekly")).toBe("0100-01-05");
  expect(advanceSubscriptionBilling("2026-12-25", "bi-weekly")).toBe("2027-01-08");
});
it("rejects impossible dates, year zero, and calendar overflow", () => {
  for (const date of ["0000-01-01", "2026-02-29", "2026-13-01", "9999-12-31"])
    expect(() => advanceSubscriptionBilling(date, "monthly")).toThrow();
});
