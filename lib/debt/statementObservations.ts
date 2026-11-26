import type { Candidate } from "./pdfStatement";
export type StatementObservations = {
  schema_version: 1;
  as_of: string | null;
  simple_annual_rates: {
    basis: "simple_annual";
    unit: "percent";
    purchase: Candidate;
    cash: Candidate;
    balance_transfer: Candidate;
  };
  estimated_interest: {
    kind: "forecast";
    period: "next_month";
    currency: "GBP";
    candidate: Candidate;
  };
  non_sterling_fee: {
    kind: "conditional";
    basis: "transaction_amount";
    unit: "percent";
    condition: "non_sterling_transactions";
    candidate: Candidate;
  };
  card_last_four: Candidate;
  issuer: "capital_one" | null;
};
/** Build a bounded candidate using only fixed labels, never document excerpts. */
function candidate(values: { value: string; page: number }[], label: string): Candidate {
  const unique = [...new Set(values.map((v) => v.value))];
  return {
    value: unique.length === 1 ? unique[0] : null,
    confidence: !values.length ? "missing" : unique.length === 1 ? "high" : "ambiguous",
    provenance: values.slice(0, 50).map((v) => ({ page: v.page, label })),
  };
}
/** Extract informational statement terms; these never supply APR or posted money. */
export function extractStatementObservations(
  text: string,
  asOf: string | null
): StatementObservations {
  const found: Record<string, { value: string; page: number }[]> = {
    purchase: [],
    cash: [],
    balance_transfer: [],
    interest: [],
    fee: [],
    card: [],
  };
  let issuer: StatementObservations["issuer"] = null;
  text
    .split("\f")
    .slice(0, 50)
    .forEach((page, pi) => {
      let annualLines = 0;
      let annualColumn: number | null = null;
      let forecastColumn: number | null = null;
      let forecastLine = -2;
      page.split(/\r?\n/).forEach((raw, lineIndex) => {
        const normalized = raw.replace(/[\u00a0\u202f]/g, " ");
        const cells = [...normalized.matchAll(/\S.*?(?=\s{2,}|$)/g)];
        for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci];
          const column = cell.index!;
          const line = cell[0]
            .replace(/[\u00a0\u202f]/g, " ")
            .replace(/[’‘]/g, "'")
            .trim();
          const joined = `${line} ${cells[ci + 1]?.[0] || ""}`.trim();
          if (/^(?:following )?simple annual (?:interest )?rates?\s*:?$/i.test(line)) {
            annualLines = 8;
            annualColumn = column;
            continue;
          }
          if (/^Next month's estimated interest will be$/i.test(line)) {
            forecastColumn = column;
            forecastLine = lineIndex;
            continue;
          }
          if (
            forecastColumn !== null &&
            lineIndex === forecastLine + 1 &&
            Math.abs(column - forecastColumn) <= 2 &&
            /^£\d{1,8}\.\d{2}\.?$/.test(line)
          ) {
            found.interest.push({
              value: line.replace(/[£,.]/g, "").replace(/(\d{2})$/, ".$1"),
              page: pi + 1,
            });
            forecastColumn = null;
          }
          if (/\bCapital One\b/i.test(line)) issuer = "capital_one";
          if (/^simple annual (?:interest )?rates?\s*:?$/i.test(line)) {
            annualLines = 6;
            annualColumn = column;
            continue;
          }
          const inline = line.match(
            /^(?:standard )?(purchases?|cash(?: withdrawals| advances)?|balance transfers?)\s+(?:simple annual (?:interest )?rate)\s*:?\s*(\d{1,3}(?:\.\d{1,3})?)\s*%$/i
          );
          const row =
            annualLines > 0 && (annualColumn === null || Math.abs(column - annualColumn) <= 2)
              ? joined.match(
                  /^(?:standard )?(purchases?|cash(?: withdrawals| advances)?|balance transfers?)\s*:?\s+(\d{1,3}(?:\.\d{1,3})?)\s*%$/i
                )
              : null;
          const m = inline || row;
          if (m) {
            const key = /^purchase/i.test(m[1])
              ? "purchase"
              : /^cash/i.test(m[1])
                ? "cash"
                : "balance_transfer";
            found[key].push({ value: m[2], page: pi + 1 });
          }

          const interest = line.match(
            /^(?:estimated interest (?:for )?next month|next month's estimated interest)\s*:?\s*£([\d,]+\.\d{2})$/i
          );
          if (interest && /^\d{1,8}\.\d{2}$/.test(interest[1].replace(/,/g, "")))
            found.interest.push({
              value: interest[1].replace(/,/g, ""),
              page: pi + 1,
            });
          const fee = joined.match(
            /^non[- ]sterling (?:transaction )?fee\s*:?\s*(\d{1,3}(?:\.\d{1,3})?)\s*%$/i
          );
          if (fee) found.fee.push({ value: fee[1], page: pi + 1 });
          const card = line.match(
            /^(?:(?:card (?:number|ending)|account (?:number|ending)|Mastercard)\s*:?\s*)?(?:[Xx*•]{4}[ -]?){3}(\d{4})$/i
          );
          if (card) found.card.push({ value: card[1], page: pi + 1 });
        }
        if (annualLines > 0) annualLines--;
      });
    });
  return {
    schema_version: 1,
    as_of: asOf,
    simple_annual_rates: {
      basis: "simple_annual",
      unit: "percent",
      purchase: candidate(found.purchase, "Purchase simple annual rate"),
      cash: candidate(found.cash, "Cash simple annual rate"),
      balance_transfer: candidate(found.balance_transfer, "Balance transfer simple annual rate"),
    },
    estimated_interest: {
      kind: "forecast",
      period: "next_month",
      currency: "GBP",
      candidate: candidate(found.interest, "Estimated interest next month"),
    },
    non_sterling_fee: {
      kind: "conditional",
      basis: "transaction_amount",
      unit: "percent",
      condition: "non_sterling_transactions",
      candidate: candidate(found.fee, "Non-sterling transaction fee"),
    },
    card_last_four: candidate(found.card, "Masked card last four"),
    issuer,
  };
}
