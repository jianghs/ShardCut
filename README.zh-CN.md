# ShardCut

[English](README.md) | 简体中文

ShardCut 是一款面向大文件场景的跨平台文件切割与合并工具，支持 Windows、Linux 和 macOS。当前版本专注本地单文件处理，提供现代化桌面端和 CLI，两者复用同一套 Rust 核心库。

## 功能特性

- 支持按固定大小、按份数、按行数切割文件。
- 支持将分片合并还原为原始文件。
- 合并前校验每个分片的 SHA-256，合并后校验还原文件的 SHA-256。
- 每次切割生成 JSON manifest，记录分片名称、大小、哈希、切割方式和版本信息。
- 写入分片时使用 `.tmp` 临时文件，避免任务中断后留下半成品文件。
- 按行切割采用流式字节扫描，不解析文本编码，适合超大日志、CSV、TSV 和文本导出文件。
- 按行切割时可选“每个分片重复首行表头”，适用于 CSV、TSV、TXT；合并时会自动去除重复表头。
- 对空输入、路径不存在、切割大小过大、份数不合理等情况进行校验，并给出友好的错误提示。
- 桌面端支持系统文件和文件夹选择器、友好状态展示、国际化界面，以及固定尺寸的工具型布局。

## 项目结构

```text
ShardCut/
|-- core/              # Rust 核心库：切割、合并、校验、manifest
|-- cli/               # 命令行工具
|-- desktop/           # Tauri + React 桌面端
|-- Cargo.toml         # Rust workspace
`-- README.md          # 英文 README，默认入口
```

## CLI 使用

按大小切割：

```powershell
cargo run -p shardcut-cli -- split .\big.log --size 1GB --out .\parts
```

按份数切割：

```powershell
cargo run -p shardcut-cli -- split .\big.log --parts 10 --out .\parts
```

按行数切割：

```powershell
cargo run -p shardcut-cli -- split .\big.csv --lines 1000000 --out .\parts
```

按行数切割并重复表头：

```powershell
cargo run -p shardcut-cli -- split .\big.csv --lines 1000000 --repeat-header --out .\parts
```

校验分片：

```powershell
cargo run -p shardcut-cli -- verify .\parts\big.log.manifest.json
```

合并还原：

```powershell
cargo run -p shardcut-cli -- merge .\parts\big.log.manifest.json --out .\restored.log
```

## 桌面端开发

安装前端依赖：

```powershell
cd desktop
npm install
```

启动桌面端开发模式：

```powershell
npm run tauri -- dev
```

仅构建前端：

```powershell
npm run build
```

## Windows 绿色版

Windows 发布默认使用绿色版，也就是免安装版本，不生成 MSI 或 NSIS 安装器。构建后会得到一个可直接运行的 exe 文件：

```powershell
cd desktop
npm run build:portable:win
```

构建完成后，可执行文件位于：

```text
target/release/shardcut-desktop.exe
```

发布绿色版时，将 `shardcut-desktop.exe` 和必要的发布说明放入同一个目录后压缩即可。用户解压后可直接运行，不需要安装。

## 验证

核心测试：

```powershell
cargo test -p shardcut-core
```

CLI 编译检查：

```powershell
cargo check -p shardcut-cli
```

桌面端 Rust 外壳检查：

```powershell
cargo check -p shardcut-desktop
```

桌面端前端构建：

```powershell
cd desktop
npm run build
```

## 当前范围

ShardCut `0.1.0` 仅处理本地单文件切割与合并，不包含目录打包、压缩、加密、云同步或网络传输。当前优先保证大文件处理的稳定性、可恢复性、清晰校验和强 SHA-256 校验。
