import { describe, expect, it } from "vitest";
import { parseMoneyMinor, formatMoneyDecimal } from "../lib/debt/money";
import { deriveDebtBalance } from "../lib/debt/reconciliation";
import { parseStatementText } from "../lib/debt/pdfStatement";

describe("exact debt money", () => {
  it("roundtrips pennies and the database limit without float arithmetic", () => {
    for (const amount of ["0.00", "0.01", "99999999.99"])
      expect(formatMoneyDecimal(parseMoneyMinor(amount))).toBe(amount);
    expect(parseMoneyMinor("12.3")).toBe(1230);
  });
  it("rejects signs, exponents, excess precision, whitespace and unsafe minor units", () => {
    for (const value of ["-1", "1e2", "1.001", " 1", "01", "100000000"])
      expect(() => parseMoneyMinor(value)).toThrow();
    for (const value of [-1, 1.2, 10000000000, NaN])
      expect(() => formatMoneyDecimal(value)).toThrow();
  });
});
const payments = [
  { id: "p1", amount: "10.01", status: "posted" as const },
  { id: "p2", amount: "3.00", status: "pending" as const },
];
describe("reported versus tracked balance", () => {
  it("subtracts only explicitly excluded posted payments and preserves pending", () => {
    expect(
      deriveDebtBalance("100.00", payments, [
        { paymentId: "p1", disposition: "excluded" },
      ]),
    ).toEqual({
      reportedBalance: "100.00",
      trackedBalance: "89.99",
      reconciliationNeeded: false,
      pendingTotal: "3.00",
    });
    expect(
      deriveDebtBalance("100.00", payments, [
        { paymentId: "p1", disposition: "included" },
      ]).trackedBalance,
    ).toBe("100.00");
  });
  it("requires explicit inclusion rather than inferring it from payment dates", () => {
    expect(
      deriveDebtBalance("100.00", payments, [
        { paymentId: "p1", disposition: "unresolved" },
      ]).trackedBalance,
    ).toBeNull();
    expect(() => deriveDebtBalance("100.00", payments, [])).toThrow(
      "Classify every active payment",
    );
  });
  it("rejects duplicate, unknown, pending classifications and overpayment", () => {
    for (const ids of [["p1", "p1"], ["other"], ["p1", "p2"]])
      expect(() =>
        deriveDebtBalance(
          "100.00",
          payments,
          ids.map((paymentId) => ({
            paymentId,
            disposition: "excluded" as const,
          })),
        ),
      ).toThrow();
    expect(() =>
      deriveDebtBalance("1.00", payments, [
        { paymentId: "p1", disposition: "excluded" },
      ]),
    ).toThrow("Payment exceeds");
  });
});
describe("synthetic statement observations", () => {
  it("keeps simple annual rates, forecast money and conditional fee separate from APR and posted fees", () => {
    const parsed = parseStatementText(
      "SYNTHETIC Capital One\nStatement balance £421.37\nStatement date 12 October 27\nPurchase simple annual rate: 29.123%\nEstimated interest next month: £8.76\nNon-sterling transaction fee: 2.75%\nCard number XXXX XXXX XXXX 1234",
    );
    expect(parsed.candidates.amount.value).toBe("421.37");
    expect(parsed.candidates.current_apr.confidence).toBe("missing");
    expect(parsed.candidates.fees.confidence).toBe("missing");
    expect(parsed.observations.simple_annual_rates.purchase.value).toBe(
      "29.123",
    );
    expect(parsed.observations.estimated_interest.kind).toBe("forecast");
    expect(parsed.observations.non_sterling_fee.kind).toBe("conditional");
    expect(parsed.observations.card_last_four.value).toBe("1234");
    expect(parsed.observations.as_of).toBe("2027-10-12");
  });
  it("retains ambiguity, missing fields and fixed-label provenance without private text", () => {
    const parsed = parseStatementText(
      "SYNTHETIC\nStatement balance £1.00\fStatement balance £2.00\nStatement date 31 Nov 26\n4000 1111 2222 3333",
    );
    expect(parsed.candidates.amount.confidence).toBe("ambiguous");
    expect(parsed.candidates.observed_on.confidence).toBe("ambiguous");
    expect(parsed.observations.card_last_four.confidence).toBe("missing");
    expect(parsed.candidates.amount.provenance).toEqual([
      { page: 1, label: "Statement balance" },
      { page: 2, label: "Statement balance" },
    ]);
  });
});
