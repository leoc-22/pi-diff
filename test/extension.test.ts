import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/extension.ts";

describe("Pi extension registration", () => {
  it("registers /diff and session cleanup without starting resources", () => {
    const registerCommand = vi.fn();
    const on = vi.fn();

    extension({ registerCommand, on } as unknown as ExtensionAPI);

    expect(registerCommand).toHaveBeenCalledOnce();
    expect(registerCommand).toHaveBeenCalledWith(
      "diff",
      expect.objectContaining({
        description: expect.stringContaining("@path"),
        handler: expect.any(Function),
      }),
    );
    expect(on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });
});
