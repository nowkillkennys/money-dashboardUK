"use client";
import { useEffect, useState } from "react";
import {
  getPendingMainCommands,
  hydratePendingMainCommands,
  resolvePendingMainCommand,
} from "@/lib/workspace/main-client";
export function MainCommandRetry() {
  const [pending, setPending] = useState<ReturnType<typeof getPendingMainCommands>>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setPending(getPendingMainCommands());
    };
    void hydratePendingMainCommands()
      .then(update)
      .catch(() => {
        if (live) setError("Unable to check pending changes. Reload before changing records.");
      });
    window.addEventListener("main-command-state", update);
    return () => {
      live = false;
      window.removeEventListener("main-command-state", update);
    };
  }, []);
  if (!pending.length && !error) return null;
  return (
    <aside
      role="status"
      className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900"
    >
      <p>
        {pending.length
          ? "A previous change has not been acknowledged. Resolve it before making another change."
          : error}
      </p>
      {error && pending.length > 0 && <p>{error}</p>}
      {pending.length > 0 && (
        <button
          className="mt-2 rounded-full border px-4 py-2"
          disabled={busy || pending[0].inFlight}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await resolvePendingMainCommand();
              window.location.reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Unable to resolve change");
            } finally {
              setBusy(false);
            }
          }}
        >
          Resolve pending change
        </button>
      )}
    </aside>
  );
}
