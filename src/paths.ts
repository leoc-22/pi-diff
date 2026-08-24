import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

export interface RepositoryPath {
  absolutePath: string;
  gitPath: string;
  isFile: boolean;
}

export async function resolveRepositoryPath(
  cwd: string,
  repositoryRoot: string,
  selectedPath: string,
): Promise<RepositoryPath> {
  const canonicalRoot = await realpath(repositoryRoot);
  const canonicalCwd = await realpath(cwd);
  if (!isPathInside(canonicalRoot, canonicalCwd)) {
    throw new Error("The current directory is outside the resolved Git worktree.");
  }

  const candidate = resolve(canonicalCwd, selectedPath);
  if (!isPathInside(canonicalRoot, candidate)) {
    throw new Error("The selected path is outside the current Git worktree.");
  }

  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch {
    throw new Error(`The selected path does not exist: ${selectedPath}`);
  }
  if (!isPathInside(canonicalRoot, canonicalCandidate)) {
    throw new Error("The selected path resolves outside the current Git worktree.");
  }

  const info = await stat(canonicalCandidate);
  const gitPath = relative(canonicalRoot, candidate).split(sep).join("/") || ".";
  return { absolutePath: candidate, gitPath, isFile: info.isFile() };
}
