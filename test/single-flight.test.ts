import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "../client/src/single-flight.ts";

describe("createSingleFlight", () => {
  it("shares an active operation and starts a new one after it settles", async () => {
    let finish: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const run = createSingleFlight(task);

    const first = run();
    const second = run();
    expect(second).toBe(first);
    expect(task).toHaveBeenCalledOnce();

    finish?.();
    await first;
    await Promise.resolve();

    const third = run();
    expect(third).not.toBe(first);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after the active operation rejects", async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(undefined);
    const run = createSingleFlight(task);

    await expect(run()).rejects.toThrow("failed");
    await expect(run()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
