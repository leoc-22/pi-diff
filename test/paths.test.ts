import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInside, resolveRepositoryPath } from "../src/paths.ts";

describe("isPathInside", () => {
  it("accepts the root and descendants", () => {
    const root = resolve("/tmp/repository");
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, join(root, "src", "file.ts"))).toBe(true);
  });

  it("rejects traversal and similarly prefixed siblings", () => {
    const root = resolve("/tmp/repository");
    expect(isPathInside(root, join(root, "..", "outside.ts"))).toBe(false);
    expect(isPathInside(root, resolve("/tmp/repository-other/file.ts"))).toBe(false);
  });
});

describe("resolveRepositoryPath", () => {
  it("returns a repository-relative Git path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-diff-root-"));
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "space name.ts"), "export {};\n");
    await expect(resolveRepositoryPath(root, root, "nested/space name.ts")).resolves.toMatchObject({
      gitPath: "nested/space name.ts",
      isFile: true,
    });
  });

  it("rejects lexical traversal, missing paths, and symlinks outside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-diff-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-diff-outside-"));
    const outsideFile = join(outside, "secret.ts");
    await writeFile(outsideFile, "secret\n");
    await symlink(outsideFile, join(root, "external-link.ts"));

    await expect(resolveRepositoryPath(root, root, "../outside.ts")).rejects.toThrow("outside");
    await expect(resolveRepositoryPath(root, root, "missing.ts")).rejects.toThrow("does not exist");
    await expect(resolveRepositoryPath(root, root, "external-link.ts")).rejects.toThrow("resolves outside");
  });
});
