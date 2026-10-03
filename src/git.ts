import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffCommandOptions } from "./arguments.ts";
import { resolveRepositoryPath } from "./paths.ts";

const GIT_TIMEOUT_MS = 30_000;

export interface DiffRequest {
  repositoryRoot: string;
  cwd: string;
  path?: string;
  pathIsFile?: boolean;
  staged: boolean;
  ref?: string;
}

export interface DiffPayload {
  patch: string;
  repository: string;
  scope: string;
  generatedAt: string;
}

function gitFailure(stderr: string, fallback: string): Error {
  return new Error(stderr.trim() || fallback);
}

export async function createDiffRequest(
  pi: ExtensionAPI,
  cwd: string,
  options: DiffCommandOptions,
): Promise<DiffRequest> {
  const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
  });
  if (rootResult.code !== 0) {
    throw gitFailure(rootResult.stderr, "The current directory is not inside a Git worktree.");
  }
  const repositoryRoot = rootResult.stdout.trim();
  if (!repositoryRoot) throw new Error("Git did not return a worktree root.");

  if (!options.path) return { repositoryRoot, cwd, staged: options.staged, ref: options.ref };

  const selected = await resolveRepositoryPath(cwd, repositoryRoot, options.path);
  return {
    repositoryRoot,
    cwd,
    staged: options.staged,
    ref: options.ref,
    path: selected.gitPath,
    pathIsFile: selected.isFile,
  };
}

function describeScope(request: DiffRequest): string {
  const target = request.path ? ` · ${request.path}` : "";
  if (request.staged) return `staged changes${target}`;
  if (request.ref) return `${request.ref}${target}`;
  return `working tree${target}`;
}

function nullSeparatedPaths(output: string): string[] {
  return output.split("\0").filter((path) => path.length > 0);
}

async function diffAgainstEmptyFile(
  pi: ExtensionAPI,
  repositoryRoot: string,
  path: string,
): Promise<string> {
  const untracked = await pi.exec(
    "git",
    [
      "diff",
      "--no-index",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--",
      "/dev/null",
      path,
    ],
    { cwd: repositoryRoot, timeout: GIT_TIMEOUT_MS },
  );
  if (untracked.code !== 0 && untracked.code !== 1) {
    throw gitFailure(untracked.stderr, `git diff --no-index failed with exit code ${untracked.code}.`);
  }
  return untracked.stdout;
}

async function untrackedFilePatch(
  pi: ExtensionAPI,
  repositoryRoot: string,
  path: string,
): Promise<string> {
  const tracked = await pi.exec("git", ["ls-files", "--error-unmatch", "--", path], {
    cwd: repositoryRoot,
    timeout: GIT_TIMEOUT_MS,
  });
  if (tracked.code === 0) return "";
  return diffAgainstEmptyFile(pi, repositoryRoot, path);
}

async function untrackedDirectoryPatch(
  pi: ExtensionAPI,
  repositoryRoot: string,
  directory: string,
): Promise<string> {
  const tracked = await pi.exec("git", ["ls-files", "--error-unmatch", "--", directory], {
    cwd: repositoryRoot,
    timeout: GIT_TIMEOUT_MS,
  });
  // A directory that already contains tracked files keeps ordinary git diff output.
  if (tracked.code === 0) return "";

  const listed = await pi.exec(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard", "--", directory],
    { cwd: repositoryRoot, timeout: GIT_TIMEOUT_MS },
  );
  if (listed.code !== 0) {
    throw gitFailure(listed.stderr, `git ls-files failed with exit code ${listed.code}.`);
  }

  const patches: string[] = [];
  for (const file of nullSeparatedPaths(listed.stdout)) {
    const selected = await resolveRepositoryPath(repositoryRoot, repositoryRoot, file);
    if (!selected.isFile) continue;
    patches.push(await diffAgainstEmptyFile(pi, repositoryRoot, selected.gitPath));
  }
  return patches.join("");
}

export async function generateDiff(pi: ExtensionAPI, request: DiffRequest): Promise<DiffPayload> {
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ];
  if (request.staged) args.push("--cached");
  if (request.ref) args.push(request.ref);
  args.push("--");
  if (request.path) args.push(request.path);

  const result = await pi.exec("git", args, { cwd: request.repositoryRoot, timeout: GIT_TIMEOUT_MS });
  if (result.code !== 0) {
    throw gitFailure(result.stderr, `git diff failed with exit code ${result.code}.`);
  }

  let patch = result.stdout;
  if (!patch && request.path && !request.staged && !request.ref) {
    if (request.pathIsFile) {
      patch = await untrackedFilePatch(pi, request.repositoryRoot, request.path);
    } else if (request.pathIsFile === false) {
      patch = await untrackedDirectoryPatch(pi, request.repositoryRoot, request.path);
    }
  }

  return {
    patch,
    repository: request.repositoryRoot,
    scope: describeScope(request),
    generatedAt: new Date().toISOString(),
  };
}
