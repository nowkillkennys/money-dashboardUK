import { expect, it } from "vitest";
import { inspectPdfBytes, readPdfBody } from "../../lib/workspace/pdf";
function syntheticPdf(lines: string[]) {
  const stream =
    "BT /F1 11 Tf 50 750 Td " +
    lines
      .map((line, i) => (i ? "0 -16 Td " : "") + "(" + line.replace(/[()\\]/g, "\\$&") + ") Tj")
      .join("\n") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
it("extracts a synthetic PDF locally without retaining raw text", async () => {
  const parsed = await inspectPdfBytes(
    syntheticPdf([
      "SYNTHETIC TEST ONLY",
      "Statement balance 123.45",
      "Statement date 26 November 2026",
    ])
  );
  expect(parsed.candidates.amount.value).toBe("123.45");
  expect(parsed.candidates.observed_on.value).toBe("2026-11-26");
  expect(parsed).not.toHaveProperty("text");
});
it("rejects malformed, oversize and image-only PDF inputs", async () => {
  await expect(inspectPdfBytes(Buffer.from("not a pdf"))).rejects.toThrow("valid PDF");
  await expect(inspectPdfBytes(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("5 MiB");
  await expect(inspectPdfBytes(syntheticPdf([]))).rejects.toThrow("image-only");
});
it("bounds streamed raw PDF bytes and enforces content type", async () => {
  await expect(
    readPdfBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      })
    )
  ).rejects.toThrow("application/pdf");
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(5 * 1024 * 1024));
      c.enqueue(new Uint8Array(1));
      c.close();
    },
  });
  await expect(
    readPdfBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: stream,
        duplex: "half",
      } as RequestInit)
    )
  ).rejects.toThrow("5 MiB");
});

it("deduplicates previews by owner, renews expiry and rejects confirmed/disabled imports", async () => {
  const { Pool } = await import("pg");
  const { randomUUID } = await import("node:crypto");
  const { previewPdf } = await import("../../lib/workspace/pdf");
  const admin = new Pool({
    connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL,
  });
  const owner = randomUUID(),
    other = randomUUID();
  try {
    await admin.query(
      "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3),($4,$5,$3)",
      [owner, "pdf-" + owner, "disabled-synthetic-hash", other, "pdf-" + other]
    );
    const bytes = syntheticPdf(["SYNTHETIC PDF DEDUP", "Statement balance 123.45"]);
    const first = await previewPdf(owner, bytes);
    expect((await previewPdf(owner, bytes)).id).toBe(first.id);
    expect((await previewPdf(other, bytes)).id).not.toBe(first.id);
    await admin.query(
      "UPDATE workspace_pdf_previews SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [first.id]
    );
    expect((await previewPdf(owner, bytes)).id).toBe(first.id);
    const { executeCommand } = await import("../../lib/workspace/ledger");
    const account = await executeCommand(other, randomUUID(), {
      action: "create",
      name: "Synthetic PDF account",
      kind: "loan",
      amount: "123.45",
      asOf: "2026-11-26",
    });
    await admin.query(
      "UPDATE workspace_pdf_previews SET confirmed_account_id=$1 WHERE owner_id=$2",
      [account.id, other]
    );
    await expect(previewPdf(other, bytes)).rejects.toThrow("already confirmed");
    await admin.query("UPDATE workspace_features SET pdf=false WHERE owner_id=$1", [owner]);
    await expect(previewPdf(owner, bytes)).rejects.toThrow("disabled");
  } finally {
    await admin.end();
  }
});
