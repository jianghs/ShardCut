# ShardCut

English | [简体中文](README.zh-CN.md)

ShardCut is a cross-platform large-file splitter and merger for Windows, Linux, and macOS. It focuses on local single-file workflows and provides both a modern desktop app and a CLI backed by the same Rust core.

## Features

- Split a file by fixed size, part count, or line count.
- Merge split parts back into the original file.
- Verify every part with SHA-256 before merge and verify the restored file after merge.
- Generate a JSON manifest for each split task, including part names, sizes, hashes, split mode, and version metadata.
- Use `.tmp` files during writes to avoid leaving half-written output when a task is interrupted.
- Stream line-based splitting without decoding text, making it suitable for huge logs, CSV files, TSV files, and text exports.
- Optionally repeat the first-line header for line-based CSV, TSV, and TXT splits. Merge automatically removes duplicated headers.
- Reject invalid split plans, including empty inputs, missing paths, oversized split sizes, and unreasonable part counts.
- Desktop app supports file pickers, drag-and-drop input, recent directory memory, cancellable tasks, progress/speed/ETA display, bilingual UI, and friendly validation messages.
- Desktop layout uses a fixed-size utility window with a sticky top bar, hidden-but-usable vertical scrolling, inline progress/results, and full wrapping for long result paths.

## Project Layout

```text
ShardCut/
|-- core/              # Rust core: split, merge, verify, manifest
|-- cli/               # Command-line interface
|-- desktop/           # Tauri + React desktop app
|-- Cargo.toml         # Rust workspace
`-- README.zh-CN.md    # Chinese README
```

## CLI Usage

Split by size:

```powershell
cargo run -p shardcut-cli -- split .\big.log --size 1GB --out .\parts
```

Split by part count:

```powershell
cargo run -p shardcut-cli -- split .\big.log --parts 10 --out .\parts
```

Split by line count:

```powershell
cargo run -p shardcut-cli -- split .\big.csv --lines 1000000 --out .\parts
```

Split by line count and repeat the header:

```powershell
cargo run -p shardcut-cli -- split .\big.csv --lines 1000000 --repeat-header --out .\parts
```

Verify parts:

```powershell
cargo run -p shardcut-cli -- verify .\parts\big.log.manifest.json
```

Merge and restore:

```powershell
cargo run -p shardcut-cli -- merge .\parts\big.log.manifest.json --out .\restored.log
```

## Desktop Development

Install frontend dependencies:

```powershell
cd desktop
npm install
```

Start the desktop app in development mode:

```powershell
npm run tauri -- dev
```

Build the frontend only:

```powershell
npm run build
```

## Windows Portable Build

The Windows release is a portable build by default. It does not generate MSI or NSIS installers. The app builds to a directly runnable executable:

```powershell
cd desktop
npm run build:portable:win
```

After the build finishes, the executable is located at:

```text
target/release/shardcut-desktop.exe
```

If the previous executable is still running, Windows may prevent the build from replacing it. Close ShardCut before rebuilding.

For distribution, place `shardcut-desktop.exe` and release notes in one folder, then zip the folder. Users can unzip it and run the executable directly.

## Verification

Core tests:

```powershell
cargo test -p shardcut-core
```

CLI check:

```powershell
cargo check -p shardcut-cli
```

Desktop Rust shell check:

```powershell
cargo check -p shardcut-desktop
```

Desktop frontend build:

```powershell
cd desktop
npm run build
```

## Roadmap

Planned improvements are tracked in [ROADMAP.md](ROADMAP.md).

## Current Scope

ShardCut `0.1.0` handles local single-file splitting and merging. It does not include directory packaging, compression, encryption, cloud sync, or network transfer. The current priority is stable, recoverable large-file processing with clear validation, strong SHA-256 verification, and a clean desktop workflow.
