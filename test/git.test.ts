import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parsePatchFiles } from "@pierre/diffs";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseDiffArguments } from "../src/arguments.ts";
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

  it("renders untracked files under a selected directory as new files", async () => {
    const root = await makeRepository();
    await mkdir(join(root, "new dir", "nested"), { recursive: true });
    await writeFile(join(root, "new dir", "file.ts"), "export const added = true;\n");
    await writeFile(join(root, "new dir", "nested", "inner.ts"), "export const inner = true;\n");
    await writeFile(join(root, ".gitignore"), "ignored.ts\n");
    await writeFile(join(root, "new dir", "ignored.ts"), "export const hidden = true;\n");

    for (const input of ['"new dir"', '@"new dir"']) {
      const request = await createDiffRequest(pi, root, parseDiffArguments(input));
      expect(request.path).toBe("new dir");
      expect(request.pathIsFile).toBe(false);
      const result = await generateDiff(pi, request);
      const files = parsePatchFiles(result.patch).flatMap((entry) => entry.files);
      expect(files).toHaveLength(2);
      expect(result.patch).toContain("new file mode");
      expect(result.patch).toContain("+export const added = true;");
      expect(result.patch).toContain("+export const inner = true;");
      expect(result.patch).not.toContain("export const hidden = true");
    }

    const plainRoot = await makeRepository();
    await mkdir(join(plainRoot, "newdir"));
    await writeFile(join(plainRoot, "newdir", "file.ts"), "export const plain = true;\n");
    for (const input of ["newdir", "@newdir"]) {
      const result = await generateDiff(pi, await createDiffRequest(pi, plainRoot, parseDiffArguments(input)));
      expect(result.patch).toContain("+export const plain = true;");
      expect(parsePatchFiles(result.patch).flatMap((entry) => entry.files)).toHaveLength(1);
    }
  });

  it("does not include untracked files in an unfiltered working-tree diff", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "kept.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "--", "kept.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, "kept.ts"), "export const value = 2;\n");
    await mkdir(join(root, "new dir"), { recursive: true });
    await writeFile(join(root, "new dir", "file.ts"), "export const added = true;\n");

    const result = await generateDiff(pi, await createDiffRequest(pi, root, parseDiffArguments("")));
    expect(result.patch).toContain("+export const value = 2;");
    expect(result.patch).not.toContain("export const added = true");
  });

  it("keeps staged and ref diffs limited to tracked changes", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "kept.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "--", "kept.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, "kept.ts"), "export const value = 2;\n");
    await execFileAsync("git", ["add", "--", "kept.ts"], { cwd: root });
    await mkdir(join(root, "new dir"), { recursive: true });
    await writeFile(join(root, "new dir", "file.ts"), "export const added = true;\n");

    const stagedDirectory = await generateDiff(
      pi,
      await createDiffRequest(pi, root, parseDiffArguments('--staged @"new dir"')),
    );
    expect(stagedDirectory.patch).toBe("");

    const stagedFile = await generateDiff(
      pi,
      await createDiffRequest(pi, root, parseDiffArguments("--staged kept.ts")),
    );
    expect(stagedFile.patch).toContain("+export const value = 2;");
    expect(stagedFile.patch).not.toContain("export const added = true");

    const refDirectory = await generateDiff(
      pi,
      await createDiffRequest(pi, root, parseDiffArguments('--ref HEAD @"new dir"')),
    );
    expect(refDirectory.patch).toBe("");

    const refFile = await generateDiff(
      pi,
      await createDiffRequest(pi, root, parseDiffArguments("--ref HEAD kept.ts")),
    );
    expect(refFile.patch).toContain("+export const value = 2;");
    expect(refFile.patch).not.toContain("export const added = true");
  });

  it("does not treat a tracked directory as an untracked directory", async () => {
    const root = await makeRepository();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "kept.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "--", "src/kept.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(join(root, "src", "new.ts"), "export const added = true;\n");

    const clean = await generateDiff(pi, await createDiffRequest(pi, root, { staged: false, path: "src" }));
    expect(clean.patch).toBe("");

    await writeFile(join(root, "src", "kept.ts"), "export const value = 2;\n");
    const changed = await generateDiff(pi, await createDiffRequest(pi, root, { staged: false, path: "src" }));
    expect(changed.patch).toContain("+export const value = 2;");
    expect(changed.patch).not.toContain("export const added = true");
  });

  it("rejects an untracked directory entry that resolves outside the worktree", async () => {
    const root = await makeRepository();
    const outside = await mkdtemp(join(tmpdir(), "pi-diff-outside-"));
    await mkdir(join(root, "new dir"));
    await writeFile(join(root, "new dir", "kept.ts"), "export const kept = true;\n");
    await writeFile(join(outside, "secret.ts"), "secret\n");
    await symlink(join(outside, "secret.ts"), join(root, "new dir", "leak.ts"));

    const request = await createDiffRequest(pi, root, { staged: false, path: "new dir" });
    await expect(generateDiff(pi, request)).rejects.toThrow("outside");
  });
});
