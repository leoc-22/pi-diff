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

  it("allows missing paths when their nearest existing ancestor is inside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-diff-root-"));

    await expect(resolveRepositoryPath(root, root, "deleted/nested/file.ts")).resolves.toMatchObject({
      gitPath: "deleted/nested/file.ts",
      isFile: false,
    });
  });

  it("rejects lexical traversal and symlinks outside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-diff-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-diff-outside-"));
    const outsideFile = join(outside, "secret.ts");
    await writeFile(outsideFile, "secret\n");
    await symlink(outsideFile, join(root, "external-link.ts"));
    await symlink(outside, join(root, "external-directory"));

    await expect(resolveRepositoryPath(root, root, "../outside.ts")).rejects.toThrow("outside");
    await expect(resolveRepositoryPath(root, root, "external-link.ts")).rejects.toThrow("resolves outside");
    await expect(resolveRepositoryPath(root, root, "external-directory/missing.ts")).rejects.toThrow("resolves outside");
  });
});
