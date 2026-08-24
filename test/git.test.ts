import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parsePatchFiles } from "@pierre/diffs";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createDiffRequest, generateDiff } from "../src/git.ts";

const execFileAsync = promisify(execFile);

const pi = {
  async exec(command: string, args: string[], options: { cwd?: string; timeout?: number }) {
    try {
      const result = await execFileAsync(command, args, {
        cwd: options.cwd,
        timeout: options.timeout,
        encoding: "utf8",
      });
      return { stdout: result.stdout, stderr: result.stderr, code: 0, killed: false };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        code: typeof failure.code === "number" ? failure.code : 1,
        killed: failure.killed ?? false,
      };
    }
  },
} as unknown as ExtensionAPI;

async function makeRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-diff-repo-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Pi Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "pi@example.test"], { cwd: root });
  return root;
}

describe("Git diff generation", () => {
  it("disables configured text conversion for tracked and untracked diffs", async () => {
    const calls: string[][] = [];
    const fakePi = {
      async exec(_command: string, args: string[]) {
        calls.push(args);
        if (args[0] === "ls-files") return { stdout: "", stderr: "", code: 1, killed: false };
        return { stdout: "", stderr: "", code: args.includes("--no-index") ? 1 : 0, killed: false };
      },
    } as unknown as ExtensionAPI;

    await generateDiff(fakePi, {
      repositoryRoot: "/tmp/example",
      cwd: "/tmp/example",
      staged: false,
      path: "untracked.txt",
      pathIsFile: true,
    });

    const diffCalls = calls.filter((args) => args[0] === "diff");
    expect(diffCalls).toHaveLength(2);
    expect(diffCalls.every((args) => args.includes("--no-textconv"))).toBe(true);
  });

  it("generates a working-tree diff for a selected path with spaces", async () => {
    const root = await makeRepository();
    const name = "space name.ts";
    await writeFile(join(root, name), "const value = 1;\n");
    await execFileAsync("git", ["add", "--", name], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, name), "const value = 2;\n");

    const request = await createDiffRequest(pi, root, { staged: false, path: name });
    const result = await generateDiff(pi, request);
    expect(result.patch).toContain("diff --git");
    expect(result.patch).toContain("+const value = 2;");
    expect(parsePatchFiles(result.patch).flatMap((entry) => entry.files)).toHaveLength(1);
  });

  it("renders a selected untracked file as a new-file diff", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "new file.ts"), "export const added = true;\n");

    const request = await createDiffRequest(pi, root, { staged: false, path: "new file.ts" });
    const result = await generateDiff(pi, request);
    expect(result.patch).toContain("new file mode");
    expect(result.patch).toContain("+export const added = true;");
    expect(parsePatchFiles(result.patch).flatMap((entry) => entry.files)).toHaveLength(1);
  });
});
