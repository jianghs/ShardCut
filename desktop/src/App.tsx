import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  File as FileIcon,
  FileJson,
  FolderOpen,
  ListRestart,
  Play,
  Plus,
  X,
  RotateCw,
  Scissors,
  Settings,
  SplitSquareHorizontal,
  TriangleAlert
} from "lucide-react";
import shardcutIcon from "./assets/shardcut-icon.png";
import { text, friendlyError, isCopyKey, type Language, type CopyKey } from "./i18n";

type Mode = "size" | "parts" | "lines";
type View = "split" | "merge";
type SizeUnit = "KB" | "MB" | "GB" | "TB";

type SplitManifest = {
  original_file_name: string;
  original_size: number;
  original_sha256: string;
  parts: Array<{ file_name: string; size: number; sha256: string; lines?: number }>;
};

type ManifestSummary = {
  original_file_name: string;
};

const DEFAULT_MAX_PARTS = 100;

type TaskProgress = {
  phase: "Splitting" | "Merging" | "Verifying" | "Completed";
  bytes_done: number;
  bytes_total: number;
  current_part: number;
  speed_bps: number;
  eta_seconds?: number | null;
  lines_done?: number | null;
};

type ProgressEvent = {
  task_id: string;
  progress: TaskProgress;
};

type PageStatus =
  | { kind: "cancelled" }
  | { kind: "error"; message?: string; messageKey?: CopyKey }
  | { kind: "mergeDone"; output: string }
  | { kind: "running" }
  | { kind: "splitDone"; count: number }
  | { kind: "verifyFailed" }
  | { kind: "verifyOk" };

type DetailPanel = {
  titleKey: CopyKey;
  items: Array<{ labelKey: CopyKey; value: string }>;
  parts?: SplitManifest["parts"];
  issues?: Array<{ key: CopyKey; value?: string }>;
};

type PageState = {
  status: PageStatus | null;
  details: DetailPanel | null;
  outputPath?: string;
};

type RecentDirs = {
  inputDir: string;
  outputDir: string;
  manifestDir: string;
  restoreDir: string;
};

const RECENT_DIRS_KEY = "shardcut.recentDirs";
const MAX_PARTS_KEY = "shardcut.maxParts";
const emptyRecentDirs: RecentDirs = {
  inputDir: "",
  outputDir: "",
  manifestDir: "",
  restoreDir: ""
};

const emptyPageState: PageState = { status: null, details: null };

export default function App() {
  const [recentDirs, setRecentDirs] = useState<RecentDirs>(loadRecentDirs);
  const [view, setView] = useState<View>("split");
  const [mode, setMode] = useState<Mode>("size");
  const [inputPath, setInputPath] = useState("");
  const [manifestPath, setManifestPath] = useState("");
  const [sizeValue, setSizeValue] = useState("1");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("KB");
  const [countValue, setCountValue] = useState("10");
  const [lineValue, setLineValue] = useState("1,000,000");
  const [repeatHeader, setRepeatHeader] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [maxPartsValue, setMaxPartsValue] = useState(loadMaxPartsValue);
  const [language, setLanguage] = useState<Language>("zh");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [dragActiveTarget, setDragActiveTarget] = useState<"input" | "manifest" | null>(null);
  const [pageState, setPageState] = useState<Record<View, PageState>>({
    split: emptyPageState,
    merge: emptyPageState
  });
  const [progressState, setProgressState] = useState<Record<View, TaskProgress | null>>({
    split: null,
    merge: null
  });

  const copy = text[language];
  const activeState = pageState[view];
  const activeProgress = progressState[view];
  const sizePreview = useMemo(
    () => `${copy.approx} ${formatBytes(sizeBytes(sizeValue, sizeUnit) || 0)}`,
    [copy, sizeUnit, sizeValue]
  );
  const maxParts = parseIntegerInput(maxPartsValue);

  useEffect(() => {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(recentDirs));
  }, [recentDirs]);

  useEffect(() => {
    const parsed = parseIntegerInput(maxPartsValue);
    if (parsed && parsed >= 2) {
      localStorage.setItem(MAX_PARTS_KEY, String(parsed));
    }
  }, [maxPartsValue]);

  useEffect(() => {
    if (!settingsOpen) return;
    function closeSettings(event: MouseEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", closeSettings);
    return () => document.removeEventListener("mousedown", closeSettings);
  }, [settingsOpen]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragActiveTarget(dropTargetAt(event.payload.position));
        return;
      }
      if (event.payload.type === "leave") {
        setDragActiveTarget(null);
        return;
      }
      const target = dropTargetAt(event.payload.position);
      setDragActiveTarget(null);
      const [path] = event.payload.paths;
      if (!path || !target) return;
      if (target === "manifest") {
        if (!path.toLowerCase().endsWith(".json")) return;
        setManifestPath(path);
        rememberDir("manifestDir", parentDir(path));
        return;
      }
      if (target !== "input") return;
      setInputPath(path);
      rememberDir("inputDir", parentDir(path));
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  async function chooseInputFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: recentDirs.inputDir || undefined
    });
    if (typeof selected !== "string") return;
    setInputPath(selected);
    rememberDir("inputDir", parentDir(selected));
  }

  async function chooseManifestFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: recentDirs.manifestDir || undefined,
      filters: [{ name: copy.manifestFilterLabel, extensions: ["json"] }]
    });
    if (typeof selected === "string") {
      setManifestPath(selected);
      rememberDir("manifestDir", parentDir(selected));
    }
  }

  async function runSplit() {
    const validation = await validateSplit();
    if (validation) return showError("split", validation);
    await runTask("split", async (taskId) => {
      const output = defaultSplitOutputDir(inputPath.trim());
      rememberDir("inputDir", parentDir(inputPath.trim()));
      rememberDir("outputDir", output);
      const result = await invoke<SplitManifest>("split", {
        taskId,
        inputPath: inputPath.trim(),
        outputDir: output,
        mode,
        value: splitValue(),
        repeatHeader,
        overwrite,
        maxParts: maxParts ?? DEFAULT_MAX_PARTS
      });
      const manifest = joinPath(output, `${result.original_file_name}.manifest.json`);
      setPage("split", {
        status: { kind: "splitDone", count: result.parts.length },
        outputPath: output,
        details: {
          titleKey: "splitDone",
          items: [
            { labelKey: "fileName", value: result.original_file_name },
            { labelKey: "fileSize", value: formatBytes(result.original_size) },
            { labelKey: "partCount", value: formatNumber(result.parts.length) },
            { labelKey: "manifestPath", value: manifest },
            { labelKey: "originalHash", value: shortHash(result.original_sha256) }
          ],
          parts: result.parts
        }
      });
    });
  }

  async function runMerge() {
    const validation = validateMerge();
    if (validation) return showError("merge", validation);

    await runTask("merge", async (taskId) => {
      rememberDir("manifestDir", parentDir(manifestPath.trim()));
      const summary = await invoke<ManifestSummary>("manifest_summary", { manifestPath: manifestPath.trim() });
      const outputPath = defaultMergeOutputPath(manifestPath.trim(), summary.original_file_name);
      const output = await invoke<string>("merge", {
        taskId,
        manifestPath: manifestPath.trim(),
        outputPath,
        overwrite
      });
      setPage("merge", {
        status: { kind: "mergeDone", output },
        outputPath: output,
        details: {
          titleKey: "mergeDone",
          items: [
            { labelKey: "outputPath", value: output },
            { labelKey: "manifestPath", value: manifestPath.trim() }
          ],
          issues: [{ key: "verifyOk" }]
        }
      });
    });
  }

  async function runTask(target: View, task: (taskId: string) => Promise<void>) {
    const taskId = `${target}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const unlisten = await listen<ProgressEvent>("task-progress", (event) => {
      if (event.payload.task_id !== taskId) return;
      setProgress(target, event.payload.progress);
    });
    setBusy(true);
    setCurrentTaskId(taskId);
    setPage(target, { status: { kind: "running" }, details: null });
    setProgress(target, null);
    try {
      await task(taskId);
    } catch (error) {
      const message = friendlyError(String(error));
      if (message === "cancelled") {
        setPage(target, { status: { kind: "cancelled" }, details: null });
      } else {
        showError(target, message);
      }
    } finally {
      setBusy(false);
      setCurrentTaskId(null);
      unlisten();
    }
  }

  async function cancelCurrentTask() {
    if (!currentTaskId) return;
    try {
      await invoke("cancel_task", { taskId: currentTaskId });
    } catch {
      // The task may have completed before the click is handled.
    }
  }

  function setPage(target: View, state: PageState) {
    setPageState((current) => ({ ...current, [target]: state }));
  }

  function setProgress(target: View, progress: TaskProgress | null) {
    setProgressState((current) => ({ ...current, [target]: progress }));
  }

  function showError(target: View, message: CopyKey | string) {
    setPage(target, { status: errorStatus(message), details: null });
  }

  function rememberDir(key: keyof RecentDirs, dir: string) {
    if (!dir.trim()) return;
    setRecentDirs((current) => ({ ...current, [key]: dir }));
  }

  function splitValue() {
    if (mode === "size") return `${normalizeNumber(sizeValue)}${sizeUnit}`;
    if (mode === "parts") return String(parseIntegerInput(countValue));
    return String(parseIntegerInput(lineValue));
  }

  async function validateSplit() {
    if (!inputPath.trim()) return "chooseInput";
    if (!parentDir(inputPath.trim())) return "chooseInput";
    const partSize = sizeBytes(sizeValue, sizeUnit);
    if (mode === "size" && !partSize) return "invalidSize";
    if (!maxParts || maxParts < 2) return "invalidMaxParts";
    if (mode === "size" && partSize) {
      try {
        const inputSize = await invoke<number>("file_size", { path: inputPath.trim() });
        if (Math.ceil(inputSize / partSize) > maxParts) {
          return "tooManyParts";
        }
      } catch {
        return "pathMissing";
      }
    }
    const count = parseIntegerInput(countValue);
    const lines = parseIntegerInput(lineValue);
    if (mode === "parts" && (!count || count < 2)) return "invalidParts";
    if (mode === "parts" && count && count > maxParts) return "tooManyParts";
    if (mode === "lines" && (!lines || lines < 1)) return "invalidLines";
    if (mode === "lines" && repeatHeader && !supportsRepeatHeader(inputPath)) return "invalidHeaderFormat";
    return "";
  }

  function validateMerge() {
    if (!manifestPath.trim()) return "chooseManifest";
    return "";
  }

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark"><img src={shardcutIcon} alt="" /></div>
            <div>
              <strong>ShardCut</strong>
              <span>0.1.0</span>
            </div>
          </div>
          <div className="mode-tabs" role="tablist" aria-label={copy.modeTabs}>
            <button type="button" className={view === "split" ? "active" : ""} onClick={() => setView("split")}>
              <Scissors size={17} />
              {copy.split}
            </button>
            <button type="button" className={view === "merge" ? "active" : ""} onClick={() => setView("merge")}>
              <SplitSquareHorizontal size={17} />
              {copy.merge}
            </button>
          </div>
          <div className="settings-wrap" ref={settingsRef}>
            <button type="button" className="icon-button" aria-label={copy.settings} onClick={() => setSettingsOpen((open) => !open)}>
              <Settings size={18} />
            </button>
            {settingsOpen && (
              <div className="settings-popover">
                <label>
                  <span>{copy.language}</span>
                   <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                    <option value="zh">{text["zh"].langLabel}</option>
                    <option value="en">{text["en"].langLabel}</option>
                  </select>
                </label>
                <label>
                  <span>{copy.maxParts}</span>
                  <input
                    inputMode="numeric"
                    value={maxPartsValue}
                    onChange={(event) => setMaxPartsValue(formatNumericInput(event.target.value))}
                  />
                </label>
                <label className="settings-check">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  <span>{copy.overwrite}</span>
                </label>
              </div>
            )}
          </div>
        </header>

        <div className="workbench">
          <section className="operation-pane">
            <div className="mode-heading">
              {view === "split" ? <Scissors size={21} /> : <SplitSquareHorizontal size={21} />}
              <h1>{view === "split" ? copy.split : copy.merge}</h1>
            </div>

            {view === "split" && (
              <form className="tool-panel" onSubmit={(event) => { event.preventDefault(); void runSplit(); }}>
            <PathField label={copy.inputFile} value={inputPath} dropTarget="input" dropTitle={copy.dropInputTitle} dropActiveTitle={copy.releaseInputDrop} emptyText={copy.noFileSelected} clearLabel={copy.clearSelectedFile} dragActive={dragActiveTarget === "input"} icon={<FileIcon size={20} />} onBrowse={chooseInputFile} onClear={() => setInputPath("")} clearDisabled={busy} />

            <div className="field-row">
              <label>{copy.mode}</label>
              <div className="mode-grid">
                <button type="button" className={mode === "size" ? "active" : ""} onClick={() => selectMode("size")}>
                  <SplitSquareHorizontal size={18} />
                  <span>{copy.size}</span>
                </button>
                <button type="button" className={mode === "parts" ? "active" : ""} onClick={() => selectMode("parts")}>
                  <FileJson size={18} />
                  <span>{copy.parts}</span>
                </button>
                <button type="button" className={mode === "lines" ? "active" : ""} onClick={() => selectMode("lines")}>
                  <ListRestart size={18} />
                  <span>{copy.lines}</span>
                </button>
              </div>
            </div>

            {mode === "size" && (
              <div className="field-row">
                <label htmlFor="split-size">{copy.sizeValue}</label>
                <div className="size-input">
                  <input id="split-size" inputMode="decimal" value={sizeValue} onChange={(event) => setSizeValue(event.target.value)} />
                  <select aria-label={copy.sizeUnit} value={sizeUnit} onChange={(event) => setSizeUnit(event.target.value as SizeUnit)}>
                    <option value="KB">KB</option>
                    <option value="MB">MB</option>
                    <option value="GB">GB</option>
                    <option value="TB">TB</option>
                  </select>
                </div>
              </div>
            )}

            {mode === "parts" && (
              <NumberField label={copy.partsValue} value={countValue} onChange={setCountValue} />
            )}

            {mode === "lines" && (
              <NumberField label={copy.linesValue} value={lineValue} onChange={setLineValue} />
            )}

            {mode === "size" && sizePreview && <p className="input-hint">{sizePreview}</p>}

            {mode === "lines" && (
              <div className="check-block">
                <label className="check-row">
                  <input type="checkbox" checked={repeatHeader} onChange={(event) => setRepeatHeader(event.target.checked)} />
                  {copy.repeatHeader}
                </label>
                <p>{copy.repeatHeaderHelp}</p>
              </div>
            )}

            <div className="command-row">
              {busy && currentTaskId && <button type="button" onClick={() => void cancelCurrentTask()}><TriangleAlert size={16} />{copy.cancel}</button>}
              <button className="primary" disabled={busy} type="submit"><Play size={16} />{copy.startSplit}</button>
            </div>
              </form>
            )}

            {view === "merge" && (
              <form className="tool-panel" onSubmit={(event) => { event.preventDefault(); void runMerge(); }}>
            <PathField label={copy.manifest} value={manifestPath} dropTarget="manifest" dropTitle={copy.dropManifestTitle} dropActiveTitle={copy.releaseManifestDrop} emptyText={copy.noManifestSelected} clearLabel={copy.clearSelectedFile} dragActive={dragActiveTarget === "manifest"} icon={<FileJson size={20} />} onBrowse={chooseManifestFile} onClear={() => setManifestPath("")} clearDisabled={busy} />
            <div className="command-row">
              {busy && currentTaskId && <button type="button" onClick={() => void cancelCurrentTask()}><TriangleAlert size={16} />{copy.cancel}</button>}
              <button className="primary" disabled={busy} type="submit"><RotateCw size={16} />{copy.startMerge}</button>
            </div>
              </form>
            )}
            <footer className={`statusbar ${statusClass(activeState.status)}`}>
              {statusIcon(activeState.status)}
              <span>{statusText(activeState.status, copy)}</span>
            </footer>
            {activeState.outputPath && !busy && (
              <button className="open-folder-btn" type="button" onClick={() => { invoke("open_folder", { path: activeState.outputPath }); }}>
                <FolderOpen size={16} />
                {copy.openOutputFolder}
              </button>
            )}
            {activeProgress && <ProgressPanel progress={activeProgress} copy={copy} />}
            {activeState.details && <ResultPanel details={activeState.details} copy={copy} />}
          </section>
        </div>
      </section>
    </main>
  );
}

function PathField(props: {
  label: string;
  value: string;
  dropTarget?: "input" | "manifest";
  dropTitle?: string;
  dropActiveTitle?: string;
  emptyText?: string;
  clearLabel: string;
  dragActive?: boolean;
  icon?: ReactNode;
  onBrowse: () => Promise<void>;
  onClear?: () => void;
  clearDisabled?: boolean;
}) {
  const hasValue = props.value.trim().length > 0;
  const selectedFileName = hasValue ? fileName(props.value) : "";

  function clearPath(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (props.clearDisabled) return;
    props.onClear?.();
  }

  return (
    <div className="field-row">
      <label>{props.label}</label>
      <div className="path-control">
        <div
          className={`path-drop ${props.dragActive ? "drag-active" : ""} ${hasValue ? "has-file" : "empty"}`}
          data-drop-target={props.dropTarget}
          role="button"
          tabIndex={0}
          onClick={() => void props.onBrowse()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void props.onBrowse();
            }
          }}
        >
          <div className="path-drop-icon">{hasValue ? props.icon : <Plus size={23} />}</div>
          <div className="path-drop-copy">
            <div className="path-drop-title">
              {hasValue ? selectedFileName : (props.dragActive ? props.dropActiveTitle : props.dropTitle)}
            </div>
            <div className={`path-drop-value ${hasValue ? "" : "empty"}`} title={props.value}>
              {hasValue ? props.value : props.emptyText}
            </div>
          </div>
          {hasValue && props.onClear && (
            <button
              aria-label={props.clearLabel}
              className="path-clear"
              disabled={props.clearDisabled}
              type="button"
              onClick={clearPath}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NumberField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field-row">
      <label>{props.label}</label>
      <input inputMode="numeric" value={props.value} onChange={(event) => props.onChange(formatNumericInput(event.target.value))} />
    </div>
  );
}

function ProgressPanel(props: { progress: TaskProgress; copy: Record<CopyKey, string> }) {
  const percent = props.progress.bytes_total > 0
    ? Math.min(100, (props.progress.bytes_done / props.progress.bytes_total) * 100)
    : 100;
  const eta = props.progress.eta_seconds == null ? "--" : formatDuration(props.progress.eta_seconds, props.copy);
  return (
    <section className="progress-panel" aria-label={props.copy.taskProgress}>
      <div className="progress-topline">
        <strong>{phaseLabel(props.progress.phase, props.copy)}</strong>
        <span>{percent.toFixed(1)}%</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-metrics">
        <span>{formatBytes(props.progress.bytes_done)} / {formatBytes(props.progress.bytes_total)}</span>
        <span>{formatBytes(props.progress.speed_bps)}/s</span>
        <span>{props.copy.eta} {eta}</span>
        <span>{props.copy.partMetric} {formatNumber(props.progress.current_part)}</span>
        {props.progress.lines_done != null && <span>{props.copy.linesMetric} {formatNumber(props.progress.lines_done)}</span>}
      </div>
    </section>
  );
}

function ResultPanel(props: { details: DetailPanel; copy: typeof text.zh }) {
  const shownParts = props.details.parts?.slice(0, 6) ?? [];
  const hiddenPartCount = Math.max((props.details.parts?.length ?? 0) - shownParts.length, 0);
  return (
    <section className="details">
      <div className="details-title">
        <FileJson size={17} />
        <h2>{props.copy[props.details.titleKey]}</h2>
      </div>
      <dl className="result-grid">
        {props.details.items.map((item) => (
          <div key={item.labelKey}>
            <dt>{props.copy[item.labelKey]}</dt>
            <dd title={item.value}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {props.details.issues && (
        <div className="issue-list">
          {props.details.issues.map((issue) => (
            <span key={`${issue.key}-${issue.value ?? ""}`}>
              {issue.value ? `${props.copy[issue.key]}: ${issue.value}` : props.copy[issue.key]}
            </span>
          ))}
        </div>
      )}
      {shownParts.length > 0 && (
        <div className="part-list">
          <div className="part-list-title">{props.copy.partPreview}</div>
          {shownParts.map((part) => (
            <div className="part-row" key={part.file_name}>
              <span>{part.file_name}</span>
              <strong>{formatBytes(part.size)}</strong>
            </div>
          ))}
          {hiddenPartCount > 0 && <p>{props.copy.moreParts}: {formatNumber(hiddenPartCount)}</p>}
        </div>
      )}
    </section>
  );
}

function statusClass(status: PageStatus | null) {
  if (status?.kind === "error" || status?.kind === "verifyFailed") return "error";
  if (status?.kind === "splitDone" || status?.kind === "mergeDone" || status?.kind === "verifyOk") return "success";
  if (status?.kind === "running") return "running";
  return "";
}

function statusIcon(status: PageStatus | null) {
  const className = "status-icon";
  if (status?.kind === "error" || status?.kind === "verifyFailed") return <TriangleAlert className={className} size={16} />;
  if (status?.kind === "splitDone" || status?.kind === "mergeDone" || status?.kind === "verifyOk") return <CheckCircle2 className={className} size={16} />;
  if (status?.kind === "running") return <RotateCw className={className} size={16} />;
  return <FileJson className={className} size={16} />;
}

function statusText(status: PageStatus | null, copy: typeof text.zh) {
  if (!status) return copy.idle;
  if (status.kind === "cancelled") return copy.cancelled;
  if (status.kind === "error") return `${copy.error}: ${status.messageKey ? copy[status.messageKey] : status.message}`;
  if (status.kind === "mergeDone") return `${copy.mergeDone}: ${status.output}`;
  if (status.kind === "running") return copy.running;
  if (status.kind === "splitDone") return `${copy.splitDone}: ${formatNumber(status.count)}`;
  if (status.kind === "verifyFailed") return copy.verifyFailed;
  return copy.verifyOk;
}

function errorStatus(message: CopyKey | string): PageStatus {
  if (isCopyKey(message)) return { kind: "error", messageKey: message };
  return { kind: "error", message };
}

function loadMaxPartsValue() {
  const parsed = parseIntegerInput(localStorage.getItem(MAX_PARTS_KEY) ?? "");
  return String(parsed && parsed >= 2 ? parsed : DEFAULT_MAX_PARTS);
}

function loadRecentDirs(): RecentDirs {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return emptyRecentDirs;
    const parsed = JSON.parse(raw) as Partial<RecentDirs>;
    return {
      inputDir: typeof parsed.inputDir === "string" ? parsed.inputDir : "",
      outputDir: typeof parsed.outputDir === "string" ? parsed.outputDir : "",
      manifestDir: typeof parsed.manifestDir === "string" ? parsed.manifestDir : "",
      restoreDir: typeof parsed.restoreDir === "string" ? parsed.restoreDir : ""
    };
  } catch {
    return emptyRecentDirs;
  }
}

function defaultSplitOutputDir(inputPath: string) {
  const dir = parentDir(inputPath);
  const name = fileName(inputPath);
  return joinPath(dir, `${name}.shardcut-parts`);
}

function defaultMergeOutputPath(manifestPath: string, originalFileName: string) {
  const dir = parentDir(manifestPath);
  const file = `restored-${originalFileName}`;
  return dir ? joinPath(dir, file) : file;
}

function fileName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function dropTargetAt(position: { x: number; y: number }) {
  const scale = window.devicePixelRatio || 1;
  const element = document.elementFromPoint(position.x / scale, position.y / scale);
  const target = element?.closest<HTMLElement>("[data-drop-target]")?.dataset.dropTarget;
  return target === "input" || target === "manifest" ? target : null;
}

function parseIntegerInput(input: string) {
  const normalized = input.replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatNumericInput(input: string) {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  return formatNumber(Number.parseInt(digits, 10));
}

function normalizeNumber(input: string) {
  return input.replace(/[,_\s]/g, "");
}

function sizeBytes(input: string, unit: SizeUnit) {
  const normalized = normalizeNumber(input);
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit];
  return value * multiplier;
}

function supportsRepeatHeader(path: string) {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return extension === "csv" || extension === "tsv" || extension === "txt";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatDuration(seconds: number, copy: Record<CopyKey, string>) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (minutes > 0) return `${minutes}${copy.durationMin} ${String(remainingSeconds).padStart(2, "0")}${copy.durationSec}`;
  return `${remainingSeconds}${copy.durationSec}`;
}

function phaseLabel(phase: TaskProgress["phase"], copy: typeof text.zh) {
  if (phase === "Merging") return copy.phaseMerging;
  if (phase === "Verifying") return copy.phaseVerifying;
  if (phase === "Completed") return copy.phaseCompleted;
  return copy.phaseSplitting;
}

function shortHash(hash: string) {
  return hash.length > 20 ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : hash;
}

function parentDir(path: string) {
  const trimmed = path.trim();
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index > 0 ? trimmed.slice(0, index) : "";
}

function joinPath(folder: string, fileName: string) {
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

