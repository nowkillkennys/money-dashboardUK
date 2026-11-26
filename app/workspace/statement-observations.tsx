import type { parseStatementText } from "@/lib/debt/pdfStatement";
export type ParsedStatement = ReturnType<typeof parseStatementText>;
export function StatementObservations({ parsed }: { parsed: ParsedStatement }) {
  return (
    <dl className="space-y-2 text-sm">
      {Object.entries({
        minimum_payment: "Minimum payment (£)",
        credit_limit: "Credit limit (£)",
        fees: "Posted fees (£)",
        current_apr: "Purchase APR (%)",
      }).map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {parsed.candidates[key].value ?? "Not established"} ·{" "}
            {parsed.candidates[key].confidence}
          </dd>
        </div>
      ))}
      {(["purchase", "cash", "balance_transfer"] as const).map((key) => (
        <div key={key}>
          <dt>{key.replace("_", " ")} simple annual rate (%) — not APR</dt>
          <dd>{parsed.observations.simple_annual_rates[key].value ?? "Not established"}</dd>
        </div>
      ))}
      <div>
        <dt>Estimated next-month interest (£) — forecast, not posted</dt>
        <dd>{parsed.observations.estimated_interest.candidate.value ?? "Not established"}</dd>
      </div>
      <div>
        <dt>Non-sterling transaction fee (%) — conditional</dt>
        <dd>{parsed.observations.non_sterling_fee.candidate.value ?? "Not established"}</dd>
      </div>
    </dl>
  );
}
