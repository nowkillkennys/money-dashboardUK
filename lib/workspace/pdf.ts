import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatementText } from "../debt/pdfStatement";
import { withUserDb } from "./db";
import { HttpError } from "./http";
const MAX_BYTES = 5 * 1024 * 1024;
let active = 0;
export async function readPdfBody(request: Request): Promise<Buffer> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/pdf")
    throw new HttpError(415, "application/pdf required");
  if (Number(request.headers.get("content-length")) > MAX_BYTES)
    throw new HttpError(413, "PDF must be at most 5 MiB");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A PDF is required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "PDF must be at most 5 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0,
      stderr = 0;
    let failure: HttpError | undefined;
    const stop = (error: HttpError) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(new HttpError(504, "PDF extraction timed out")), 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) stop(new HttpError(422, "PDF extraction output exceeds limit"));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.length;
      if (stderr > 64 * 1024) stop(new HttpError(422, "PDF extraction failed"));
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new HttpError(422, "PDF extraction unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new HttpError(422, "PDF cannot be read; encrypted or malformed PDFs are unsupported")
        );
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
export async function inspectPdfBytes(bytes: Buffer) {
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "PDF must be at most 5 MiB");
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\s|$)/.test(bytes.subarray(0, 9).toString("ascii")))
    throw new HttpError(422, "A valid PDF is required");
  if (active >= 2) throw new HttpError(429, "PDF extraction busy; try again shortly");
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "workspace-pdf-"));
    await chmod(directory, 0o700);
    const file = join(directory, "statement.pdf");
    await writeFile(file, bytes, { mode: 0o600 });
    const info = await run("pdfinfo", [file]);
    if (/^Encrypted:\s+yes/im.test(info))
      throw new HttpError(422, "Encrypted PDFs are unsupported");
    const count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > 50)
      throw new HttpError(422, "PDF must contain at most 50 pages");
    const text = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"]);
    if (!text.trim())
      throw new HttpError(
        422,
        "Scanned or image-only PDFs are unsupported; enter the statement manually"
      );
    // Poppler terminates its last page with form feed; it is not an extra page.
    return parseStatementText(text.replace(/\f\s*$/, ""));
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      active--;
    }
  }
}
export async function requirePdfFeature(ownerId: string) {
  await withUserDb(ownerId, async (client) => {
    await client.query(
      "INSERT INTO workspace_features(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
      [ownerId]
    );
    const result = await client.query("SELECT pdf FROM workspace_features WHERE owner_id=$1", [
      ownerId,
    ]);
    if (result.rows[0]?.pdf !== true) throw new HttpError(403, "PDF imports are disabled");
  });
}
export async function previewPdf(ownerId: string, bytes: Buffer) {
  await requirePdfFeature(ownerId);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const previous = await withUserDb(
    ownerId,
    async (client) =>
      (
        await client.query(
          "SELECT id,parsed,expires_at,confirmed_account_id FROM workspace_pdf_previews WHERE owner_id=$1 AND file_hash=$2",
          [ownerId, hash]
        )
      ).rows[0]
  );
  if (previous?.confirmed_account_id) throw new HttpError(409, "This PDF was already confirmed");
  if (previous && new Date(previous.expires_at).getTime() > Date.now())
    return {
      id: previous.id,
      parsed: previous.parsed,
      expiresAt: new Date(previous.expires_at).toISOString(),
    };
  const parsed = await inspectPdfBytes(bytes);
  return withUserDb(ownerId, async (client) => {
    const enabled = await client.query(
      "SELECT pdf FROM workspace_features WHERE owner_id=$1 FOR SHARE",
      [ownerId]
    );
    if (enabled.rows[0]?.pdf !== true) throw new HttpError(403, "PDF imports are disabled");
    const result = await client.query(
      `INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')
   ON CONFLICT(owner_id,file_hash) DO UPDATE SET parsed=EXCLUDED.parsed,expires_at=EXCLUDED.expires_at
   WHERE workspace_pdf_previews.confirmed_account_id IS NULL
   RETURNING id,parsed,expires_at`,
      [randomUUID(), ownerId, hash, JSON.stringify(parsed)]
    );
    if (!result.rows.length) throw new HttpError(409, "This PDF was already confirmed");
    const row = result.rows[0];
    return {
      id: row.id,
      parsed: row.parsed,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  });
}
