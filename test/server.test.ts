import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DiffViewerServer } from "../src/server.ts";

const patch = `diff --git a/example.ts b/example.ts
index 9f1e1a2..4f22989 100644
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;

const pi = {
  async exec() {
    return { stdout: patch, stderr: "", code: 0, killed: false };
  },
} as unknown as ExtensionAPI;

let activeServer: DiffViewerServer | undefined;
afterEach(async () => {
  await activeServer?.close();
  activeServer = undefined;
});

describe("DiffViewerServer", () => {
  it("serves token-scoped assets and the read-only diff API", async () => {
    activeServer = new DiffViewerServer(pi);
    activeServer.setRequest({
      repositoryRoot: "/tmp/example",
      cwd: "/tmp/example",
      staged: false,
    });
    const url = await activeServer.start();

    const page = await fetch(url);
    const api = await fetch(new URL("api/diff", url));
    const denied = await fetch(new URL("/wrong-token/", url));
    const method = await fetch(new URL("api/diff", url), { method: "POST" });

    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    await expect(api.json()).resolves.toMatchObject({ patch, repository: "/tmp/example" });
    expect(denied.status).toBe(404);
    expect(method.status).toBe(405);
  });

  it("closes idempotently", async () => {
    activeServer = new DiffViewerServer(pi);
    await expect(activeServer.close()).resolves.toBeUndefined();
    await expect(activeServer.close()).resolves.toBeUndefined();
  });
});
