"use client";
import { useEffect, useState } from "react";
import { Modal, formatMoney } from "../components/money-ui";
import {
  getCardRemovalPreview,
  deleteCreditCard,
  updateCreditCard,
  type CardRemovalPreview,
} from "@/lib/money/queries";
import type { CreditCard } from "@/lib/money/database.types";

export function CardRemovalDialog({
  card,
  onClose,
  onDone,
}: {
  card: CreditCard | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<CardRemovalPreview | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setName("");
    setError("");
    if (!card) return;
    setLoading(true);
    getCardRemovalPreview(card.id)
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card, revision]);
  const act = async (permanent: boolean) => {
    if (!card || !preview || busy || (permanent && name !== preview.name)) return;
    setBusy(true);
    setError("");
    try {
      if (permanent)
        await deleteCreditCard(card.id, preview.version, {
          mode: "permanent",
          confirmation_name: name,
          preview_token: preview.previewToken,
        });
      else await updateCreditCard(card.id, { archived: true }, preview.version);
      await onDone(
        permanent
          ? `Deleted "${preview.name}". Bank payment records were preserved.`
          : `Archived "${preview.name}". Use Show archived to restore it.`
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to remove card.");
    } finally {
      setBusy(false);
    }
  };
  const button = "rounded-xl border border-border-subtle px-4 py-2 text-sm disabled:opacity-40";
  return (
    <Modal
      open={!!card}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Remove credit card"
    >
      <div className="space-y-4">
        {loading && <p role="status">Loading removal details…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              className={button}
              disabled={busy || loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              Reload removal details
            </button>
          </div>
        )}
        {preview && (
          <>
            <p className="font-semibold">{preview.name}</p>
            <p>
              Tracked balance:{" "}
              {preview.trackedBalance === null
                ? "Unresolved"
                : formatMoney(Number(preview.trackedBalance), "GBP")}
              {preview.reconciliationNeeded ? " · Needs reconciliation" : ""}
            </p>
            <section className="rounded-xl border border-border-subtle p-3 space-y-2">
              <h3 className="font-semibold">Archive</h3>
              <p className="text-sm">
                Hide this card from the active list. Keep its balance and all history. You can
                restore it using Show archived.
              </p>
              <button
                className={button}
                disabled={busy || loading || card?.archived}
                onClick={() => act(false)}
              >
                Archive card
              </button>
            </section>
            <section className="rounded-xl border border-red-400 p-3 space-y-3">
              <h3 className="font-semibold">Permanently delete</h3>
              <p className="text-sm">
                Remove this card, {preview.charges} charges, {preview.linkedExpenses} linked
                expenses, {preview.payments} card payment records, {preview.snapshots} statement
                snapshots and {preview.pdfImports} confirmed PDF imports.
              </p>
              <p className="text-sm">
                Keep {preview.bankPayments} bank-funded repayments as read-only bank transfer
                records, preserving your bank balances. Unlink {preview.subscriptions} subscriptions
                without deleting them.
              </p>
              <p className="text-sm">
                This cannot be undone. Removing a balance from this app does not settle money owed
                to your lender. Historical totals, operation records and backups may retain
                information.
              </p>
              <label className="block text-sm" htmlFor="confirm-card-removal">
                Confirm card name
              </label>
              <input
                id="confirm-card-removal"
                className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2"
                value={name}
                disabled={busy || loading}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                placeholder={preview.name}
              />
              <button
                className={`${button} border-red-500 text-red-600`}
                disabled={busy || loading || name !== preview.name}
                onClick={() => act(true)}
              >
                Permanently delete card
              </button>
            </section>
          </>
        )}
        <button className={button} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {busy && <p role="status">Saving…</p>}
      </div>
    </Modal>
  );
}
