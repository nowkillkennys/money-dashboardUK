import { expect, it } from "vitest";
import { suggestStatementAccounts } from "../lib/debt/statementReview";
import { parseStatementText } from "../lib/debt/pdfStatement";
it("last four suggestions require opt in and never select an account", () => {
  const accounts = [
    { id: "a", lastFour: "1234" },
    { id: "b", lastFour: "1234" },
  ];
  expect(suggestStatementAccounts(false, "1234", accounts)).toEqual({
    kind: "disabled",
    accountIds: [],
  });
  expect(suggestStatementAccounts(true, "1234", accounts)).toEqual({
    kind: "collision",
    accountIds: ["a", "b"],
  });
  expect(suggestStatementAccounts(true, "1234", accounts.slice(0, 1))).toEqual({
    kind: "suggestion",
    accountIds: ["a"],
  });
  expect(suggestStatementAccounts(true, "9999", accounts)).toEqual({
    kind: "mismatch",
    accountIds: [],
  });
  expect(suggestStatementAccounts(true, null, accounts)).toEqual({
    kind: "unavailable",
    accountIds: [],
  });
});
it("parses only aligned wrapped minimum and keeps a nearby Direct Debit separate", () => {
  const col = (l: string, r: string) => l.padEnd(90, " ") + r;
  const parsed = parseStatementText(
    [
      col("SYNTHETIC EXAMPLE", "This month’s minimum payment"),
      col("is £99.99", "is                      £18.76"),
      col("Other text", "Your Direct Debit payment of £34.56"),
    ].join("\n"),
  );
  expect(parsed.candidates.minimum_payment.value).toBe("18.76");
  expect(
    parseStatementText(
      col("SYNTHETIC", "This month’s minimum payment") +
        "\n" +
        col("is £99.99", "Direct Debit £34.56"),
    ).candidates.minimum_payment.value,
  ).toBeNull();
});
it("rejects extraction limits and keeps contradictory masked hints ambiguous", () => {
  expect(() => parseStatementText("x".repeat(2 * 1024 * 1024 + 1))).toThrow(
    "limits",
  );
  expect(() => parseStatementText("\f".repeat(50))).toThrow("limits");
  const p = parseStatementText(
    "SYNTHETIC\nCard number XXXX XXXX XXXX 1234\nCard number XXXX XXXX XXXX 9876",
  );
  expect(p.observations.card_last_four.confidence).toBe("ambiguous");
});
