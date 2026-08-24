import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";

export function mapChangeTypeToGitStatus(type: ChangeTypes): GitStatus {
  switch (type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

export function createTreeGitStatus(files: readonly FileDiffMetadata[]): GitStatusEntry[] {
  return files.map((file) => ({
    path: file.name,
    status: mapChangeTypeToGitStatus(file.type),
  }));
}
