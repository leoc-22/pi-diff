# pi-diff

A [Pi](https://github.com/earendil-works/pi-mono) extension that opens local Git changes in a browser, renders them with [`@pierre/diffs`](https://diffs.com/), and provides a changed-file sidebar with [`@pierre/trees`](https://trees.software/). Source code and patches stay on your machine.

## Commands

```text
/diff
/diff path/to/file
/diff @path/to/file
/diff @"path with spaces/file.ts"
/diff --staged
/diff --staged @path/to/file
/diff --ref main...HEAD
/diff --ref main...HEAD @path/to/file
```

- `/diff` shows unstaged working-tree changes.
- `--staged` compares the index with `HEAD`.
- `--ref` passes one revision or range argument to `git diff`.
- A path limits the diff to one file or directory.
- An untracked single file is rendered as a new file in normal working-tree mode.
- A path that points at an untracked directory includes the non-ignored untracked files under that directory as new files. Plain paths, `@path`, and `@"path"` all work. `--staged` and `--ref` still show only their tracked diffs.

The viewer toolbar can switch between split and unified layouts, wrap long lines, show or hide changed-line backgrounds, and enable automatic refresh.

### Pi `@` file autocomplete

Type `/diff @` and continue typing to use Pi's built-in fuzzy file search. Select a result normally; the extension accepts both `@path` and Pi's quoted `@"path with spaces"` form. The extension does not replace Pi's autocomplete provider. Plain path completion with Tab also remains available.

## Install

Install the published package:

```bash
pi install npm:@leoc-22/pi-diff
```

Restart Pi or run `/reload` after installation.

## Install locally

Install dependencies and build the browser client:

```bash
cd /Users/leoc/Developer/pi-diff
pnpm install
pnpm build
```

Link the project into Pi's global auto-discovery directory:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn /Users/leoc/Developer/pi-diff ~/.pi/agent/extensions/pi-diff
```

Run `/reload` in Pi after source changes. For a one-off test, use:

```bash
pi -e /Users/leoc/Developer/pi-diff/index.ts
```

## Development

```bash
pnpm test   # focused parser and path-safety tests
pnpm check  # TypeScript
pnpm build  # check plus production Vite client build
```

The extension source is loaded directly by Pi through `index.ts`. Vite only builds the browser application into `dist/client`; rebuild after changing files under `client/`. The npm `prepack` script builds this directory and includes it in the published package, while `dist/` remains excluded from Git.

## Architecture and privacy

The extension registers `/diff` and lazily starts an HTTP server only after the command is used. It:

1. Resolves the current Git worktree and validates that any selected path remains inside it.
2. Runs `git` with argument arrays and `--` path separation (no shell interpolation).
3. Binds an ephemeral port on `127.0.0.1` and places a random token in every viewer route.
4. Regenerates the patch when the browser requests a refresh.
5. Parses multi-file patches with `parsePatchFiles`, displays their paths and Git statuses with `@pierre/trees`, and renders the selected file with `FileDiff`.
6. Keeps the file tree selection when refreshing if that changed path still exists.
7. Closes the server when the Pi session shuts down or reloads.

There is no upload, telemetry, remote asset, or browser endpoint that executes commands. The browser can only fetch the current diff and built static assets. The UI uses the locally installed Berkeley Mono font, with a monospace fallback.

## Limitations

- The viewer is a web page, not an embedded Pi terminal component.
- The left sidebar lists files present in the current patch; selecting a file switches the main diff surface.
- Normal Git semantics apply: `/diff` excludes staged changes, `--staged` excludes unstaged changes, and ignored files are not included in an all-files diff.
- An unfiltered `/diff` does not include every untracked file. A selected tracked directory also keeps its ordinary Git diff and does not gain untracked files.
- Binary-only patches may not have renderable text hunks.
- The browser client must be rebuilt after client-side changes.
