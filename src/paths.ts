import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

export interface RepositoryPath {
  absolutePath: string;
  gitPath: string;
  isFile: boolean;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function resolveNearestExistingAncestor(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
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

  let canonicalCandidate: string | undefined;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  const containmentTarget = canonicalCandidate ?? await resolveNearestExistingAncestor(candidate);
  if (!isPathInside(canonicalRoot, containmentTarget)) {
    throw new Error("The selected path resolves outside the current Git worktree.");
  }

  const isFile = canonicalCandidate ? (await stat(canonicalCandidate)).isFile() : false;
  const gitPath = relative(canonicalRoot, candidate).split(sep).join("/") || ".";
  return { absolutePath: candidate, gitPath, isFile };
}
