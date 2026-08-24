import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { createTreeGitStatus, mapChangeTypeToGitStatus } from "../client/src/tree.ts";

describe("diff file tree metadata", () => {
  it("maps every diff change type to a tree Git status", () => {
    expect(mapChangeTypeToGitStatus("new")).toBe("added");
    expect(mapChangeTypeToGitStatus("deleted")).toBe("deleted");
    expect(mapChangeTypeToGitStatus("change")).toBe("modified");
    expect(mapChangeTypeToGitStatus("rename-pure")).toBe("renamed");
    expect(mapChangeTypeToGitStatus("rename-changed")).toBe("renamed");
  });

  it("uses each rendered file name as the tree path", () => {
    const files = [
      { name: "src/changed.ts", type: "change" },
      { name: "src/added.ts", type: "new" },
    ] as FileDiffMetadata[];

    expect(createTreeGitStatus(files)).toEqual([
      { path: "src/changed.ts", status: "modified" },
      { path: "src/added.ts", status: "added" },
    ]);
  });

});
