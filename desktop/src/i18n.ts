export type Language = "zh" | "en";

export type CopyKey =
  | "approx"
  | "cancel"
  | "cancelled"
  | "chooseInput"
  | "chooseManifest"
  | "clearSelectedFile"
  | "corruptedParts"
  | "dropInputTitle"
  | "dropManifestTitle"
  | "durationMin"
  | "durationSec"
  | "error"
  | "eta"
  | "fileName"
  | "fileSize"
  | "idle"
  | "inputFile"
  | "invalidHeaderFormat"
  | "invalidLines"
  | "invalidMaxParts"
  | "invalidOption"
  | "invalidParts"
  | "invalidSize"
  | "invalidSplitPlan"
  | "ioDiskFull"
  | "ioFileLocked"
  | "ioFileNotFound"
  | "ioPermissionDenied"
  | "langLabel"
  | "language"
  | "lines"
  | "linesMetric"
  | "linesValue"
  | "manifest"
  | "manifestFilterLabel"
  | "manifestPath"
  | "manifestInvalid"
  | "maxParts"
  | "merge"
  | "mergeDone"
  | "missingParts"
  | "mode"
  | "modeTabs"
  | "moreParts"
  | "noFileSelected"
  | "noIssues"
  | "noManifestSelected"
  | "openOutputFolder"
  | "originalHash"
  | "outputPath"
  | "outputExists"
  | "overwrite"
  | "partCount"
  | "partMetric"
  | "partPreview"
  | "parts"
  | "partsValue"
  | "pathMissing"
  | "phaseCompleted"
  | "phaseMerging"
  | "phaseSplitting"
  | "phaseVerifying"
  | "releaseInputDrop"
  | "releaseManifestDrop"
  | "repeatHeader"
  | "repeatHeaderHelp"
  | "running"
  | "settings"
  | "size"
  | "sizeUnit"
  | "sizeValue"
  | "split"
  | "splitDone"
  | "startMerge"
  | "startSplit"
  | "taskProgress"
  | "tooManyParts"
  | "unknownError"
  | "verifyFailed"
  | "verifyOk";

export const text: Record<Language, Record<CopyKey, string>> = {
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
    maxParts: "最大分片数",
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
    invalidMaxParts: "最大分片数必须是大于等于 2 的整数。",
    tooManyParts: "当前设置会生成超过最大分片数的文件，请调大分片大小、减少份数，或在设置中调整最大分片数。",
    invalidSplitPlan: "当前切割设置不合理：请调整分片大小或分片数量，确保至少能生成 2 个非空分片。",
    invalidHeaderFormat: "重复表头仅支持 CSV、TSV、TXT 文件；请确认第一行确实是字段名或表头。",
    repeatHeaderHelp: "适用于 CSV/TSV/TXT 等第一行为表头的文本表格文件。每个分片会保留表头，合并时会自动去掉重复表头。",
    pathMissing: "路径不存在或无法访问，请重新选择文件。",
    outputExists: "输出文件已存在，请开启覆盖或换一个文件。",
    manifestInvalid: "Manifest 文件无法读取或格式不正确。",
    invalidOption: "参数无效，请检查当前设置。",
    unknownError: "操作失败，请检查文件路径和权限后重试。",
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
    openOutputFolder: "打开输出目录",
    partPreview: "分片预览",
    moreParts: "还有更多分片未显示",
    approx: "约",
    cancel: "取消",
    cancelled: "已取消",
    clearSelectedFile: "清除已选文件",
    modeTabs: "ShardCut 模式",
    taskProgress: "任务进度",
    eta: "预计剩余",
    partMetric: "分片",
    linesMetric: "行数",
    phaseSplitting: "切割中",
    phaseMerging: "合并中",
    phaseVerifying: "校验中",
    phaseCompleted: "已完成",
    ioPermissionDenied: "权限不足，无法访问文件。请检查文件是否被占用或缺少读取权限。",
    ioDiskFull: "磁盘空间不足，写入失败。请释放空间后重试。",
    ioFileLocked: "文件正在被其他程序使用，请关闭后重试。",
    ioFileNotFound: "文件未找到，请检查路径是否正确。",
    langLabel: "中文",
    manifestFilterLabel: "ShardCut 清单",
    durationMin: "分",
    durationSec: "秒",
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
    maxParts: "Max parts",
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
    invalidMaxParts: "Max parts must be an integer greater than or equal to 2.",
    tooManyParts: "The current settings would create more files than the max parts limit. Increase the part size, reduce the part count, or adjust max parts in settings.",
    invalidSplitPlan: "The current split settings are not reasonable. Adjust the part size or part count so at least 2 non-empty parts can be created.",
    invalidHeaderFormat: "Repeated headers are only supported for CSV, TSV, and TXT files. Make sure the first line is truly a header.",
    repeatHeaderHelp: "Use this for CSV/TSV/TXT files where the first line is a header. Each part keeps the header, and merge removes repeated headers automatically.",
    pathMissing: "The path does not exist or cannot be accessed. Please choose it again.",
    outputExists: "The output already exists. Enable overwrite or choose another file.",
    manifestInvalid: "The manifest cannot be read or has an invalid format.",
    invalidOption: "The option is invalid. Check the current settings.",
    unknownError: "The operation failed. Check the file path and permissions, then try again.",
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
    openOutputFolder: "Open output folder",
    partPreview: "Part preview",
    moreParts: "More parts not shown",
    approx: "about",
    cancel: "Cancel",
    cancelled: "Cancelled",
    clearSelectedFile: "Clear selected file",
    modeTabs: "ShardCut mode",
    taskProgress: "Task progress",
    eta: "ETA",
    partMetric: "Part",
    linesMetric: "Lines",
    phaseSplitting: "Splitting",
    phaseMerging: "Merging",
    phaseVerifying: "Verifying",
    phaseCompleted: "Completed",
    ioPermissionDenied: "Permission denied. Check if the file is in use or lacks read access.",
    ioDiskFull: "Insufficient disk space. Free up space and try again.",
    ioFileLocked: "The file is being used by another program. Close it and try again.",
    ioFileNotFound: "File not found. Check that the path is correct.",
    langLabel: "English",
    manifestFilterLabel: "ShardCut manifest",
    durationMin: "min",
    durationSec: "sec",
  },
};

export function isCopyKey(value: string): value is CopyKey {
  return value in text.zh;
}

const ERROR_CODE_MAP: Record<string, CopyKey> = {
  E_CANCELLED: "cancelled",
  E_INVALID_OPTION: "invalidOption",
  E_OUTPUT_EXISTS: "outputExists",
  E_JSON: "manifestInvalid",
  E_CORRUPTED_PART: "corruptedParts",
  E_HASH_MISMATCH: "verifyFailed",
  E_MISSING_PART: "missingParts",
  E_IO: "unknownError",
  E_IO_PERMISSION: "ioPermissionDenied",
  E_IO_DISK_FULL: "ioDiskFull",
  E_IO_LOCKED: "ioFileLocked",
  E_IO_NOT_FOUND: "ioFileNotFound",
  E_UNKNOWN_MODE: "invalidOption",
  E_TASK_NOT_RUNNING: "unknownError",
  E_PARSE_SIZE: "invalidOption",
};

export function friendlyError(raw: string): string {
  const sep = raw.indexOf(": ");
  if (sep === -1) return raw;
  const code = raw.slice(0, sep);
  const message = raw.slice(sep + 2);
  return ERROR_CODE_MAP[code] ?? message;
}
