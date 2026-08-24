import { parsePatchFiles, type FileDiffMetadata, type FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import {
  StrictMode,
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { createSingleFlight } from "./single-flight.ts";
import { createTreeGitStatus } from "./tree.ts";

type Layout = "unified" | "split";

interface DiffPayload {
  patch: string;
  repository: string;
  scope: string;
  generatedAt: string;
}

const TREE_STYLE = {
  height: "100%",
  "--trees-bg-override": "transparent",
  "--trees-border-color-override": "transparent",
  "--trees-border-radius-override": 0,
  "--trees-density-override": 0.82,
  "--trees-font-family-override": '"Berkeley Mono", ui-monospace, monospace',
  "--trees-font-size-override": "13px",
  "--trees-padding-inline-override": 8,
} as CSSProperties;

function DiffSidebar({
  activePath,
  files,
  onSelect,
}: {
  activePath?: string;
  files: readonly FileDiffMetadata[];
  onSelect(path: string): void;
}) {
  const paths = useMemo(() => files.map((file) => file.name), [files]);
  const gitStatus = useMemo(() => createTreeGitStatus(files), [files]);
  const { model } = useFileTree({
    paths,
    gitStatus,
    density: "compact",
    initialExpansion: "open",
    initialSelectedPaths: activePath ? [activePath] : undefined,
    search: true,
    onSelectionChange(selectedPaths) {
      for (let index = selectedPaths.length - 1; index >= 0; index -= 1) {
        const path = selectedPaths[index];
        if (path && !path.endsWith("/")) {
          onSelect(path);
          return;
        }
      }
    },
  });

  useEffect(() => {
    if (!activePath) return;
    const activeItem = model.getItem(activePath);
    if (!activeItem) return;
    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath !== activePath) model.getItem(selectedPath)?.deselect();
    }
    if (!activeItem.isSelected()) activeItem.select();
    model.scrollToPath(activePath, { offset: "nearest" });
  }, [activePath, model]);

  return (
    <aside className="sidebar" aria-label="Changed files">
      <div className="sidebar-header">
        <strong>Changed files</strong>
        <span>{files.length}</span>
      </div>
      <div className="sidebar-tree">
        <FileTree model={model} style={TREE_STYLE} />
      </div>
    </aside>
  );
}

function App() {
  const [payload, setPayload] = useState<DiffPayload>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<Layout>("split");
  const [wordWrap, setWordWrap] = useState(false);
  const [backgrounds, setBackgrounds] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activePath, setActivePath] = useState<string>();

  const refresh = useMemo(() => createSingleFlight(async () => {
    setLoading(true);
    try {
      const response = await fetch("api/diff", { cache: "no-store" });
      const body = await response.json() as DiffPayload | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : `Request failed (${response.status})`);
      setPayload(body as DiffPayload);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the diff.");
    } finally {
      setLoading(false);
    }
  }), []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  const parsed = useMemo<{ files: FileDiffMetadata[]; error?: string }>(() => {
    if (!payload?.patch) return { files: [] };
    try {
      return {
        files: parsePatchFiles(payload.patch, `pi-diff:${payload.generatedAt}`, true)
          .flatMap((patch) => patch.files),
      };
    } catch (caught) {
      return {
        files: [],
        error: caught instanceof Error ? caught.message : "The Git patch could not be parsed.",
      };
    }
  }, [payload]);

  useEffect(() => {
    setActivePath((current) => {
      if (current && parsed.files.some((file) => file.name === current)) return current;
      return parsed.files[0]?.name;
    });
  }, [parsed.files]);

  const activeFile = useMemo(
    () => parsed.files.find((file) => file.name === activePath) ?? parsed.files[0],
    [activePath, parsed.files],
  );

  const options = useMemo<FileDiffOptions<undefined>>(() => ({
    theme: { dark: "pierre-dark", light: "pierre-light" },
    diffStyle: layout,
    lineDiffType: "word",
    overflow: wordWrap ? "wrap" : "scroll",
    disableBackground: !backgrounds,
  }), [backgrounds, layout, wordWrap]);

  const displayError = error ?? parsed.error;

  return (
    <main>
      <header className="toolbar">
        <div className="identity">
          <h1>Pi Diff</h1>
          <p>{payload ? `${payload.repository} · ${payload.scope}` : "Loading repository…"}</p>
        </div>
        <div className="controls" aria-label="Diff controls">
          <div className="segmented" aria-label="Diff layout">
            <button className={layout === "unified" ? "active" : ""} onClick={() => setLayout("unified")}>Unified</button>
            <button className={layout === "split" ? "active" : ""} onClick={() => setLayout("split")}>Split</button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={wordWrap} onChange={(event) => setWordWrap(event.target.checked)} />
            Wrap lines
          </label>
          <label className="toggle">
            <input type="checkbox" checked={backgrounds} onChange={(event) => setBackgrounds(event.target.checked)} />
            Backgrounds
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            Auto-refresh
          </label>
          <button className="refresh" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="workspace">
        {!displayError && parsed.files.length > 0 && (
          <DiffSidebar
            key={payload?.generatedAt ?? "diff"}
            activePath={activePath}
            files={parsed.files}
            onSelect={setActivePath}
          />
        )}

        <section className="content" aria-live="polite">
          {displayError && <div className="state error"><strong>Could not render diff</strong><span>{displayError}</span></div>}
          {!displayError && !loading && payload && !payload.patch && (
            <div className="state"><strong>No changes</strong><span>Git reported no changes for this scope.</span></div>
          )}
          {!displayError && payload?.patch && parsed.files.length === 0 && (
            <div className="state"><strong>No text diff available</strong><span>The patch may contain only binary or unsupported changes.</span></div>
          )}
          {!displayError && activeFile && (
            <div className="diff-surface">
              <FileDiff
                key={`${payload?.generatedAt}:${activeFile.name}:${layout}:${wordWrap}:${backgrounds}`}
                fileDiff={activeFile}
                options={options}
              />
            </div>
          )}
        </section>
      </section>

      <footer>
        <span>Rendered locally with @pierre/diffs and @pierre/trees</span>
        {payload && <time dateTime={payload.generatedAt}>Updated {new Date(payload.generatedAt).toLocaleTimeString()}</time>}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
