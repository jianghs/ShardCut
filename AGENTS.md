# AGENTS.md

## Build & Test Commands

```bash
# Only test suite in the repo
cargo test -p shardcut-core

# Compile checks (no tests for these crates)
cargo check -p shardcut-cli
cargo check -p shardcut-desktop

# Frontend: type-check + bundle (tsc runs as part of build)
cd desktop && npm run build

# Desktop dev mode (starts Vite on port 1420, then Tauri window)
cd desktop && npm run tauri -- dev

# Windows portable exe (--no-bundle is required; do NOT use installer builds)
cd desktop && npm run build:portable:win
```

## Architecture

This is a Rust workspace with three crates + a React frontend:

| Directory | Crate name | Notes |
|-----------|-----------|-------|
| `core/` | `shardcut-core` | All logic in a single file: `core/src/lib.rs` (~1330 lines). No submodules. |
| `cli/` | `shardcut-cli` | Binary is named `shardcut` (not `shardcut-cli`). clap derive. |
| `desktop/src-tauri/` | `shardcut-desktop` | Crate type: `staticlib, cdylib, rlib`. Lib name: `shardcut_desktop_lib`. |
| `desktop/src/` | — | React 18 + TypeScript. Vite dev server on port 1420 (strict). |

**Core public API** (`core/src/lib.rs`):
- `split_file`, `split_file_with_progress`, `split_file_with_progress_and_cancellation` → splits by size, parts, or lines
- `merge_file`, `merge_file_with_progress`, `merge_file_with_progress_and_cancellation` → merge with SHA-256 verification
- `verify_manifest`, `read_manifest`
- Cancellation via `Arc<AtomicBool>` (not channels). Progress via `FnMut(TaskProgress)` callback (not channels).

## Conventions & Gotchas

- **Desktop window is fixed 980×620, non-resizable, non-maximizable** (`tauri.conf.json`). UI changes must fit this constraint.
- **Portable builds only** — the app uses `--no-bundle`, there are no installers. Never switch to bundled builds.
- **No lint/formatter config exists** — no rustfmt.toml, no .eslintrc, no pre-commit hooks. `npm run build` runs `tsc` (type-check) + `vite build`.
- **CLAUDE.md workflow rule**: when a ROADMAP.md item is completed, mark it `[x]`. If the item appears in both "Phase" and "Recommended Next Iteration" sections, update both.
- **Frontend file dialogs** use `@tauri-apps/plugin-dialog` (Tauri v2 plugin), not `tauri::api::dialog`.
- **Temp file pattern**: all writes go to `.tmp` files first, then `fs::rename` for atomic commit. `TempOutput` drops uncommitted `.tmp` files on `Drop`.
- **Buffer size**: 16 MB (`BUFFER_SIZE` in core).
- **Line splitting** uses `memchr` for newline scanning; no text decoding needed.

## CI

Single workflow (`.github/workflows/windows-portable.yml`) runs on push/PR to master/main and on `v*` tags. Builds Windows, macOS, and Linux portable artifacts. Runs `cargo test -p shardcut-core` before building. On version tags, publishes a GitHub Release with the three platform archives.
