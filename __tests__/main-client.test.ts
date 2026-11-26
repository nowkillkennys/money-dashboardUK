import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMainSession,
  getPendingMainCommands,
  mainCommand,
  resolvePendingMainCommand,
  hydratePendingMainCommands,
} from "../lib/workspace/main-client";

afterEach(() => {
  clearMainSession();
  vi.unstubAllGlobals();
});
describe("authenticated main commands", () => {
  it("reuses the same idempotency key after an unknown outcome and blocks unrelated writes", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("lost connection"));
    vi.stubGlobal("fetch", fetcher);
    await expect(mainCommand("bank.create", { name: "Bank" })).rejects.toThrow("result is unknown");
    const firstKey = fetcher.mock.calls[0][1].headers["Idempotency-Key"];
    expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(firstKey);
    await expect(mainCommand("bank.create", { name: "Other bank" })).rejects.toThrow(
      "pending change"
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ id: "bank", version: 1 }), { status: 200 })
    );
    await expect(resolvePendingMainCommand()).resolves.toEqual({ id: "bank", version: 1 });
    expect(fetcher.mock.calls[2][1].headers["Idempotency-Key"]).toBe(firstKey);
    expect(getPendingMainCommands()).toEqual([]);
  });
  it("does not retry a definite rejection", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "Stale version" }), { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(mainCommand("bank.update", { id: "bank", version: 1 })).rejects.toThrow(
      "Stale version"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getPendingMainCommands()).toEqual([]);
  });
  it("shares a concurrent request for the same command", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "bank", version: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const first = mainCommand("bank.create", { name: "Bank" });
    const second = mainCommand("bank.create", { name: "Bank" });
    expect(first).toBe(second);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("recovers an opaque pending key after reload and replays the server journal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ pending: [{ key: "persisted-key", action: "bank.create" }] }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "bank", version: 1 }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetcher);
    await hydratePendingMainCommands();
    expect(getPendingMainCommands()).toEqual([
      { key: "persisted-key", action: "bank.create", inFlight: false },
    ]);
    await expect(mainCommand("bank.create", { name: "New" })).rejects.toThrow("pending change");
    await resolvePendingMainCommand();
    expect(fetcher.mock.calls[1][0]).toBe("/api/workspace/main-commands/retry");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ key: "persisted-key" });
    expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe("persisted-key");
    expect(getPendingMainCommands()).toEqual([]);
  });
  it("retains a timed out command for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 408 })))
    );
    await expect(mainCommand("bank.create", { name: "Bank" })).rejects.toThrow("result is unknown");
    expect(getPendingMainCommands()).toHaveLength(1);
  });
});
