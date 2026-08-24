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
  it("treats a selected path containing wildcard characters literally", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "*.txt"), "literal one\n");
    await writeFile(join(root, "secret.txt"), "secret one\n");
    await execFileAsync("git", ["add", "-A"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, "*.txt"), "literal two\n");
    await writeFile(join(root, "secret.txt"), "secret two\n");

    const request = await createDiffRequest(pi, root, { staged: false, path: "*.txt" });
    const result = await generateDiff(pi, request);
    expect(result.patch).toContain("diff --git a/*.txt b/*.txt");
    expect(result.patch).not.toContain("secret.txt");
  });

  it("detects an untracked wildcard filename without matching tracked files", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "secret.txt"), "secret one\n");
    await execFileAsync("git", ["add", "--", "secret.txt"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, "secret.txt"), "secret two\n");
    await writeFile(join(root, "*.txt"), "literal untracked\n");

    const request = await createDiffRequest(pi, root, { staged: false, path: "*.txt" });
    const result = await generateDiff(pi, request);
    expect(result.patch).toContain("+literal untracked");
    expect(result.patch).not.toContain("secret two");
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
