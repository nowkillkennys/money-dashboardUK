import { extractStatementObservations } from "./statementObservations";
export type Candidate = {
  value: string | null;
  confidence: "high" | "missing" | "ambiguous";
  provenance: { page: number; label: string }[];
};
const definitions: Record<string, { label: string; pattern: RegExp; date?: boolean }> = {
  amount: {
    label: "Statement balance",
    pattern:
      /^(statement balance|(?:your )?new balance|(?:new )?closing balance|balance on this statement)\s*[:£]?\s*£?([\d,]+\.\d{2})\s*$/i,
  },
  minimum_payment: {
    label: "Minimum payment",
    pattern:
      /^(minimum payment(?: due)?|this month's minimum payment(?: is)?)\s*[:£]?\s*£?([\d,]+\.\d{2})\s*$/i,
  },
  credit_limit: {
    label: "Credit limit",
    pattern: /^(credit limit)\s*[:£]?\s*£?([\d,]+\.\d{2})\s*$/i,
  },
  fees: {
    label: "Fees",
    pattern: /^(total fees|fees charged)\s*[:£]?\s*£?([\d,]+\.\d{2})\s*$/i,
  },
  current_apr: {
    label: "Purchase APR",
    pattern: /^(purchase apr|annual percentage rate|apr)\s*:?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*$/i,
  },
  observed_on: {
    label: "Statement date",
    pattern: /^(statement date|statement dated)\s*:?\s*(.+)$/i,
    date: true,
  },
  payment_due_date: {
    label: "Payment due date",
    pattern: /^(payment due date|payment due by|it's due on)\s*:?\s*(.+)$/i,
    date: true,
  },
};
function dateValue(raw: string): string | null {
  let result: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) result = raw;
  else {
    const m = raw.match(/^(\d{1,2}) ([A-Za-z]+) (\d{2}|\d{4})$/);
    if (!m) return null;
    const months: Record<string, number> = {
      january: 1,
      jan: 1,
      february: 2,
      feb: 2,
      march: 3,
      mar: 3,
      april: 4,
      apr: 4,
      may: 5,
      june: 6,
      jun: 6,
      july: 7,
      jul: 7,
      august: 8,
      aug: 8,
      september: 9,
      sep: 9,
      sept: 9,
      october: 10,
      oct: 10,
      november: 11,
      nov: 11,
      december: 12,
      dec: 12,
    };
    const month = months[m[2].toLowerCase()];
    if (!month) return null;
    // Named-month statement dates with two-digit years use the explicit 2000–2099 range.
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    result = `${year}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(result);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === result ? result : null;
}
type LayoutCell = { text: string; column: number };
/** Preserve column positions so unrelated prose and payment amounts cannot be joined. */
function layoutCells(line: string): LayoutCell[] {
  const normalized = line.replace(/[\u00a0\u202f]/g, " ").replace(/[’‘]/g, "'");
  return [...normalized.matchAll(/\S.*?(?=\s{2,}|$)/g)].map((match) => ({
    text: match[0],
    column: match.index!,
  }));
}
/** Conservative labelled extraction: PDF content never executes or supplies instructions. */
export function extractCandidates(text: string): Record<string, Candidate> {
  const result: Record<string, Candidate> = {};
  const pages = text.split("\f").map((page) => page.split(/\r?\n/).map(layoutCells));
  for (const [key, def] of Object.entries(definitions)) {
    const values: (string | null)[] = [],
      provenance: Candidate["provenance"] = [];
    pages.forEach((lines, pageIndex) =>
      lines.forEach((cells, lineIndex) =>
        cells.forEach((cell, cellIndex) => {
          // Try an intact cell first; labels and values may also occupy adjacent columns.
          let match = cell.text.match(def.pattern);
          if (!match && cells[cellIndex + 1])
            match = `${cell.text} ${cells[cellIndex + 1].text}`.match(def.pattern);
          // Capital One wraps this exact label onto an aligned "is <amount>" line.
          // Never borrow a nearby Direct Debit amount or text from the left column.
          if (
            !match &&
            key === "minimum_payment" &&
            /^this month's minimum payment$/i.test(cell.text)
          ) {
            const below = lines[lineIndex + 1] || [];
            const belowIndex = below.findIndex(
              (next) => Math.abs(next.column - cell.column) <= 2 && /^is(?:\s|$)/i.test(next.text)
            );
            if (belowIndex >= 0) {
              const continuation = `${below[belowIndex].text}${below[belowIndex + 1] ? ` ${below[belowIndex + 1].text}` : ""}`;
              match = `${cell.text} ${continuation}`.match(def.pattern);
            }
          }
          if (!match) return;
          let value = def.date ? dateValue(match[2]) : match[2].replace(/,/g, "");
          if (
            !def.date &&
            (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value!) ||
              Number(value) > (key === "current_apr" ? 999.99 : 99999999.99))
          )
            value = null;
          values.push(value);
          provenance.push({
            page: pageIndex + 1,
            label: match[1].replace(/ is$/i, ""),
          });
        })
      )
    );
    const unique = [...new Set(values)];
    result[key] = {
      value: unique.length === 1 && unique[0] !== null ? unique[0] : null,
      confidence:
        values.length === 0
          ? "missing"
          : unique.length === 1 && unique[0] !== null
            ? "high"
            : "ambiguous",
      provenance,
    };
  }
  return result;
}

export const STATEMENT_PARSER_VERSION = "debt-text-v1";
export function parseStatementText(text: string) {
  if (text.length > 2 * 1024 * 1024 || text.split("\f").length > 50)
    throw new Error("Statement text exceeds extraction limits");
  const candidates = extractCandidates(text);
  return {
    parserVersion: STATEMENT_PARSER_VERSION,
    candidates,
    observations: extractStatementObservations(text, candidates.observed_on.value),
  };
}
