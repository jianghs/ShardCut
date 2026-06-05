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

type Mode = "size" | "parts" | "lines";
type View = "split" | "merge";
type Language = "zh" | "en";
type SizeUnit = "KB" | "MB" | "GB" | "TB";

type SplitManifest = {
  original_file_name: string;
  original_size: number;
  original_sha256: string;
  parts: Array<{ file_name: string; size: number; sha256: string; lines?: number }>;
};

type VerifyResult = {
  ok: boolean;
  missing_parts: string[];
  corrupted_parts: string[];
  expected_hash: string;
};

type ManifestSummary = {
  original_file_name: string;
};

const MAX_REASONABLE_PARTS = 10_000;

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

type DetailPanel = {
  title: string;
  items: Array<{ label: string; value: string }>;
  parts?: SplitManifest["parts"];
  issues?: string[];
};

type PageState = {
  status: string;
  details: DetailPanel | null;
};

type RecentDirs = {
  inputDir: string;
  outputDir: string;
  manifestDir: string;
  restoreDir: string;
};

const RECENT_DIRS_KEY = "shardcut.recentDirs";
const emptyRecentDirs: RecentDirs = {
  inputDir: "",
  outputDir: "",
  manifestDir: "",
  restoreDir: ""
};

const text = {
  zh: {
    split: "切割",
    merge: "合并",
    settings: "设置",
    inputFile: "输入文件",
    manifest: "Manifest 文件",
    dropInputTitle: "拖入文件或点击选择",
    dropManifestTitle: "拖入 Manifest JSON 或点击选择",
    releaseInputDrop: "松开以使用这个文件",
    releaseManifestDrop: "松开以使用这个 Manifest",
    noFileSelected: "尚未选择文件",
    noManifestSelected: "尚未选择 Manifest",
    startSplit: "开始切割",
    startMerge: "开始合并",
    mode: "切割方式",
    size: "按大小",
    parts: "按份数",
    lines: "按行数",
    sizeValue: "分片大小",
    sizeUnit: "单位",
    partsValue: "分片数量",
    linesValue: "每片行数",
    repeatHeader: "每个分片重复首行表头",
    language: "语言",
    overwrite: "允许覆盖已有输出",
    idle: "就绪",
    running: "执行中...",
    chooseInput: "请选择输入文件。",
    chooseManifest: "请选择 manifest 文件。",
    invalidSize: "请输入有效的分片大小，例如 1024 KB 或 100 MB。",
    invalidParts: "分片数量必须是大于等于 2 的整数。",
    invalidLines: "每片行数必须是大于 0 的整数。",
    tooManyParts: "当前分片大小会生成过多分片，请调大分片大小或改用按份数切割。",
    invalidSplitPlan: "当前切割设置不合理：请调整分片大小或分片数量，确保至少能生成 2 个非空分片。",
    invalidHeaderFormat: "重复表头仅支持 CSV、TSV、TXT 文件；请确认第一行确实是字段名或表头。",
    repeatHeaderHelp: "适用于 CSV/TSV/TXT 等第一行为表头的文本表格文件。每个分片会保留表头，合并时会自动去掉重复表头。",
    pathMissing: "路径不存在或无法访问，请重新选择文件。",
    outputExists: "输出文件已存在，请开启覆盖或换一个文件。",
    manifestInvalid: "Manifest 文件无法读取或格式不正确。",
    splitDone: "切割完成",
    verifyOk: "校验通过",
    verifyFailed: "校验失败",
    mergeDone: "合并完成",
    error: "错误",
    fileName: "文件名",
    fileSize: "文件大小",
    partCount: "分片数量",
    manifestPath: "Manifest",
    originalHash: "原文件 SHA-256",
    outputPath: "输出路径",
    missingParts: "缺失分片",
    corruptedParts: "损坏分片",
    noIssues: "未发现问题",
    partPreview: "分片预览",
    moreParts: "还有更多分片未显示",
    approx: "约"
  },
  en: {
    split: "Split",
    merge: "Merge",
    settings: "Settings",
    inputFile: "Input file",
    manifest: "Manifest file",
    dropInputTitle: "Drop file here or click to choose",
    dropManifestTitle: "Drop manifest JSON here or click to choose",
    releaseInputDrop: "Release to use this file",
    releaseManifestDrop: "Release to use this manifest",
    noFileSelected: "No file selected",
    noManifestSelected: "No manifest selected",
    startSplit: "Start split",
    startMerge: "Start merge",
    mode: "Split mode",
    size: "By size",
    parts: "By parts",
    lines: "By lines",
    sizeValue: "Part size",
    sizeUnit: "Unit",
    partsValue: "Part count",
    linesValue: "Lines per part",
    repeatHeader: "Repeat first line as header in every part",
    language: "Language",
    overwrite: "Allow overwriting existing output",
    idle: "Ready",
    running: "Running...",
    chooseInput: "Choose an input file.",
    chooseManifest: "Choose a manifest file.",
    invalidSize: "Enter a valid part size, such as 1024 KB or 100 MB.",
    invalidParts: "Part count must be an integer greater than or equal to 2.",
    invalidLines: "Lines per part must be an integer greater than 0.",
    tooManyParts: "This part size would create too many parts. Increase the size or split by part count.",
    invalidSplitPlan: "The current split settings are not reasonable. Adjust the part size or part count so at least 2 non-empty parts can be created.",
    invalidHeaderFormat: "Repeated headers are only supported for CSV, TSV, and TXT files. Make sure the first line is truly a header.",
    repeatHeaderHelp: "Use this for CSV/TSV/TXT files where the first line is a header. Each part keeps the header, and merge removes repeated headers automatically.",
    pathMissing: "The path does not exist or cannot be accessed. Please choose it again.",
    outputExists: "The output already exists. Enable overwrite or choose another file.",
    manifestInvalid: "The manifest cannot be read or has an invalid format.",
    splitDone: "Split completed",
    verifyOk: "Verification passed",
    verifyFailed: "Verification failed",
    mergeDone: "Merge completed",
    error: "Error",
    fileName: "File name",
    fileSize: "File size",
    partCount: "Part count",
    manifestPath: "Manifest",
    originalHash: "Original SHA-256",
    outputPath: "Output path",
    missingParts: "Missing parts",
    corruptedParts: "Corrupted parts",
    noIssues: "No issues found",
    partPreview: "Part preview",
    moreParts: "More parts not shown",
    approx: "about"
  }
};

const emptyPageState: PageState = { status: "", details: null };

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

  useEffect(() => {
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(recentDirs));
  }, [recentDirs]);

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
      filters: [{ name: "ShardCut manifest", extensions: ["json"] }]
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
        overwrite
      });
      const manifest = joinPath(output, `${result.original_file_name}.manifest.json`);
      setPage("split", {
        status: `${copy.splitDone}: ${formatNumber(result.parts.length)}`,
        details: {
          title: copy.splitDone,
          items: [
            { label: copy.fileName, value: result.original_file_name },
            { label: copy.fileSize, value: formatBytes(result.original_size) },
            { label: copy.partCount, value: formatNumber(result.parts.length) },
            { label: copy.manifestPath, value: manifest },
            { label: copy.originalHash, value: shortHash(result.original_sha256) }
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
      const verified = await invoke<VerifyResult>("verify", { manifestPath: manifestPath.trim() });
      if (!verified.ok) {
        setPage("merge", {
          status: copy.verifyFailed,
          details: makeVerifyDetails(verified, copy, manifestPath.trim())
        });
        return;
      }
      const summary = await invoke<ManifestSummary>("manifest_summary", { manifestPath: manifestPath.trim() });
      const outputPath = defaultMergeOutputPath(manifestPath.trim(), summary.original_file_name);
      const output = await invoke<string>("merge", {
        taskId,
        manifestPath: manifestPath.trim(),
        outputPath,
        overwrite
      });
      setPage("merge", {
        status: `${copy.mergeDone}: ${output}`,
        details: {
          title: copy.mergeDone,
          items: [
            { label: copy.outputPath, value: output },
            { label: copy.manifestPath, value: manifestPath.trim() },
            { label: copy.originalHash, value: shortHash(verified.expected_hash) }
          ],
          issues: [copy.verifyOk]
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
    setPage(target, { status: copy.running, details: null });
    setProgress(target, null);
    try {
      await task(taskId);
    } catch (error) {
      const message = friendlyError(String(error), copy);
      if (message === "Cancelled") {
        setPage(target, { status: message, details: null });
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

  function showError(target: View, message: string) {
    setPage(target, { status: `${copy.error}: ${message}`, details: null });
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
    if (!inputPath.trim()) return copy.chooseInput;
    if (!parentDir(inputPath.trim())) return copy.chooseInput;
    const partSize = sizeBytes(sizeValue, sizeUnit);
    if (mode === "size" && !partSize) return copy.invalidSize;
    if (mode === "size" && partSize) {
      try {
        const inputSize = await invoke<number>("file_size", { path: inputPath.trim() });
        if (Math.ceil(inputSize / partSize) > MAX_REASONABLE_PARTS) {
          return copy.tooManyParts;
        }
      } catch {
        return copy.pathMissing;
      }
    }
    const count = parseIntegerInput(countValue);
    const lines = parseIntegerInput(lineValue);
    if (mode === "parts" && (!count || count < 2)) return copy.invalidParts;
    if (mode === "lines" && (!lines || lines < 1)) return copy.invalidLines;
    if (mode === "lines" && repeatHeader && !supportsRepeatHeader(inputPath)) return copy.invalidHeaderFormat;
    return "";
  }

  function validateMerge() {
    if (!manifestPath.trim()) return copy.chooseManifest;
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
          <div className="mode-tabs" role="tablist" aria-label="ShardCut mode">
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
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
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
            <PathField label={copy.inputFile} value={inputPath} dropTarget="input" dropTitle={copy.dropInputTitle} dropActiveTitle={copy.releaseInputDrop} emptyText={copy.noFileSelected} dragActive={dragActiveTarget === "input"} icon={<FileIcon size={20} />} onBrowse={chooseInputFile} onClear={() => setInputPath("")} clearDisabled={busy} />

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
              {busy && currentTaskId && <button type="button" onClick={() => void cancelCurrentTask()}><TriangleAlert size={16} />Cancel</button>}
              <button className="primary" disabled={busy} type="submit"><Play size={16} />{copy.startSplit}</button>
            </div>
              </form>
            )}

            {view === "merge" && (
              <form className="tool-panel" onSubmit={(event) => { event.preventDefault(); void runMerge(); }}>
            <PathField label={copy.manifest} value={manifestPath} dropTarget="manifest" dropTitle={copy.dropManifestTitle} dropActiveTitle={copy.releaseManifestDrop} emptyText={copy.noManifestSelected} dragActive={dragActiveTarget === "manifest"} icon={<FileJson size={20} />} onBrowse={chooseManifestFile} onClear={() => setManifestPath("")} clearDisabled={busy} />
            <div className="command-row">
              {busy && currentTaskId && <button type="button" onClick={() => void cancelCurrentTask()}><TriangleAlert size={16} />Cancel</button>}
              <button className="primary" disabled={busy} type="submit"><RotateCw size={16} />{copy.startMerge}</button>
            </div>
              </form>
            )}
            <footer className={`statusbar ${statusClass(activeState.status, copy)}`}>
              {statusIcon(activeState.status, copy)}
              <span>{activeState.status || copy.idle}</span>
            </footer>
            {activeProgress && <ProgressPanel progress={activeProgress} />}
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
              aria-label="Clear selected file"
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

function ProgressPanel(props: { progress: TaskProgress }) {
  const percent = props.progress.bytes_total > 0
    ? Math.min(100, (props.progress.bytes_done / props.progress.bytes_total) * 100)
    : 100;
  const eta = props.progress.eta_seconds == null ? "--" : formatDuration(props.progress.eta_seconds);
  return (
    <section className="progress-panel" aria-label="Task progress">
      <div className="progress-topline">
        <strong>{phaseLabel(props.progress.phase)}</strong>
        <span>{percent.toFixed(1)}%</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-metrics">
        <span>{formatBytes(props.progress.bytes_done)} / {formatBytes(props.progress.bytes_total)}</span>
        <span>{formatBytes(props.progress.speed_bps)}/s</span>
        <span>ETA {eta}</span>
        <span>Part {formatNumber(props.progress.current_part)}</span>
        {props.progress.lines_done != null && <span>Lines {formatNumber(props.progress.lines_done)}</span>}
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
        <h2>{props.details.title}</h2>
      </div>
      <dl className="result-grid">
        {props.details.items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd title={item.value}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {props.details.issues && (
        <div className="issue-list">
          {props.details.issues.map((issue) => <span key={issue}>{issue}</span>)}
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

function statusClass(status: string, copy: typeof text.zh) {
  if (status.startsWith(copy.error) || status === copy.verifyFailed) return "error";
  if (status.includes(copy.splitDone) || status.includes(copy.mergeDone) || status === copy.verifyOk) return "success";
  if (status === copy.running) return "running";
  return "";
}

function statusIcon(status: string, copy: typeof text.zh) {
  const className = "status-icon";
  if (status.startsWith(copy.error) || status === copy.verifyFailed) return <TriangleAlert className={className} size={16} />;
  if (status.includes(copy.splitDone) || status.includes(copy.mergeDone) || status === copy.verifyOk) return <CheckCircle2 className={className} size={16} />;
  if (status === copy.running) return <RotateCw className={className} size={16} />;
  return <FileJson className={className} size={16} />;
}

function makeVerifyDetails(result: VerifyResult, copy: typeof text.zh, manifestPath: string): DetailPanel {
  const issues = [
    ...result.missing_parts.map((part) => `${copy.missingParts}: ${part}`),
    ...result.corrupted_parts.map((part) => `${copy.corruptedParts}: ${part}`)
  ];
  return {
    title: result.ok ? copy.verifyOk : copy.verifyFailed,
    items: [
      { label: copy.manifestPath, value: manifestPath },
      { label: copy.originalHash, value: shortHash(result.expected_hash) },
      { label: copy.missingParts, value: formatNumber(result.missing_parts.length) },
      { label: copy.corruptedParts, value: formatNumber(result.corrupted_parts.length) }
    ],
    issues: issues.length > 0 ? issues : [copy.noIssues]
  };
}

function friendlyError(error: string, copy: typeof text.zh) {
  const normalized = error.toLowerCase();
  if (normalized.includes("task was cancelled")) return "Cancelled";
  if (
    normalized.includes("empty file cannot be split") ||
    normalized.includes("fewer than two parts") ||
    normalized.includes("maximum non-empty parts")
  ) {
    return copy.invalidSplitPlan;
  }
  if (normalized.includes("repeat header is only supported")) return copy.invalidHeaderFormat;
  if (normalized.includes("output already exists")) return copy.outputExists;
  if (normalized.includes("manifest json") || normalized.includes("expected value")) return copy.manifestInvalid;
  if (normalized.includes("input is not a file") || normalized.includes("no such file") || normalized.includes("os error 2")) {
    return copy.pathMissing;
  }
  return error;
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

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

function phaseLabel(phase: TaskProgress["phase"]) {
  if (phase === "Merging") return "Merging";
  if (phase === "Verifying") return "Verifying";
  if (phase === "Completed") return "Completed";
  return "Splitting";
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

