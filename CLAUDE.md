# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ShardCut is a cross-platform large-file splitter and merger (Windows, Linux, macOS). It splits a single file by size, part count, or line count; merges parts back; and verifies integrity with SHA-256. The desktop app is built with Tauri 2.0 + React 18.

## Build & Test

```bash
# Core library tests (the only test suite)
cargo test -p shardcut-core

# Compile checks
cargo check -p shardcut-cli
cargo check -p shardcut-desktop

# Desktop frontend
cd desktop && npm install        # first time
cd desktop && npm run build      # type-check + bundle
cd desktop && npm run tauri -- dev   # full desktop app in dev mode
cd desktop && npm run build:portable:win   # Windows portable exe

# CLI (example)
cargo run -p shardcut-cli -- split ./big.log --size 1GB --out ./parts
```

## Architecture

### Workspace crates

| Crate | Package name | Purpose |
|-------|-------------|---------|
| `core/` | `shardcut-core` | Pure Rust library — all split/merge/verify logic, data types, manifest serialization |
| `cli/` | `shardcut-cli` | Thin CLI wrapper around core using clap derive |
| `desktop/src-tauri/` | `shardcut-desktop` | Tauri backend — bridges core to frontend via Tauri commands |

### Core library (`core/src/lib.rs`)

Single file, ~1340 lines. No submodules.

**Public API:**
- `split_file_with_progress_and_cancellation(opts, cancel, on_progress) -> Manifest` — three split modes (BySize/ByParts/ByLines); writes parts as `{name}.part001`, `{name}.part002`, etc.; all writes use `.tmp` staging then atomic rename
- `merge_file_with_progress_and_cancellation(opts, cancel, on_progress) -> PathBuf` — verifies every part's SHA-256 before merging, then verifies the merged file hash; uses `.tmp` staging
- `verify_manifest(path) -> VerifyResult` — checks all parts exist and hash correctly
- `read_manifest(path) -> Manifest` — deserialize a JSON manifest
- `CancellationToken` — `Arc<AtomicBool>`; `check_cancelled()` is called at every IO boundary

**Key data types:**
- `SplitMode` — `#[serde(tag = "kind")]` enum: `BySize { bytes }`, `ByParts { count }`, `ByLines { lines_per_part, repeat_header }`
- `Manifest` — includes version, original file metadata, parts list, optional `line_info`
- `ShardCutError` — thiserror enum covering IO, JSON, validation, corruption, cancellation

**Patterns:**
- Progress is reported via a callback `FnMut(TaskProgress)`, never via channels
- `TempOutput` struct commits via `fs::rename` on success, deletes `.tmp` on `Drop` if uncommitted
- Buffer size: 16MB (`BUFFER_SIZE`)
- Line-based splitting uses `memchr` for fast newline scanning without text decoding

### CLI (`cli/src/main.rs`)

Single file, ~180 lines. clap derive with three subcommands (`split`, `merge`, `verify`). Size parsing supports `KB/MB/GB/TB` with flexible format (e.g., `1GB`, `1024MB`, `100`). Progress formatted to stderr; JSON result to stdout.

### Desktop

**Frontend** (`desktop/src/App.tsx`): Single React component managing two views (split/merge) with three split modes. Bilingual UI (zh/en) via a `text` lookup object. Drag-and-drop via Tauri WebView `onDragDropEvent`. File dialogs via `@tauri-apps/plugin-dialog`. Progress received via `listen("task-progress")` events. Recent directories persisted in localStorage.

**Backend** (`desktop/src-tauri/src/lib.rs`): Tauri commands that call core functions. Tracks active tasks in `HashMap<String, CancellationToken>` behind a `Mutex<AppState>`. Commands: `split`, `merge`, `verify`, `manifest_summary`, `file_size`, `cancel_task`. Progress callbacks emit `task-progress` events to the frontend via `app.emit()`.

**Key desktop flow:**
1. Frontend invokes a Tauri command (e.g., `invoke("split", {...})`)
2. Backend registers a `CancellationToken`, spawns core work, emits progress events
3. Frontend listens to `task-progress` and renders progress bar + metrics
4. Cancellation: frontend calls `cancel_task({taskId})`, backend sets the token, core's next `check_cancelled()` returns `Err(Cancelled)`

### Test patterns

All tests are integration-style in `core/src/lib.rs` (`#[cfg(test)] mod tests`). They use `tempfile::tempdir()` for isolation and test round-trip (split → merge → assert bytes equal), cancellation cleanup (no `.tmp` files left), validation rejection, and edge cases (exact boundaries, no trailing newline, header-only files).

## Workflow rules

- **When a ROADMAP.md item is completed**, mark it `[x]` in ROADMAP.md. If the item appears in both Phase and Recommended Next Iteration sections, update both.
