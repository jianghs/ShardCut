# ShardCut

[English](README.md) | 简体中文

ShardCut 是一款面向大文件场景的跨平台文件切割与合并工具，支持 Windows、Linux 和 macOS。当前版本专注本地单文件处理，提供现代化桌面端和 CLI，两者复用同一套 Rust 核心库。

## 功能特性

- 支持按固定大小、按份数、按行数切割文件。
- 支持将分片合并还原为原始文件。
- 合并前校验每个分片的 SHA-256，合并后校验还原文件的 SHA-256。
- 每次切割生成 JSON manifest，记录分片名称、大小、哈希、切割方式和版本元数据。
- 写入分片时使用 `.tmp` 临时文件，避免任务中断后留下半成品文件。
- 按行切割采用流式字节扫描，不解析文本编码，适合超大日志、CSV、TSV 和文本导出文件。
- 按行切割时可选“每个分片重复首行表头”，适用于 CSV、TSV、TXT；合并时会自动去除重复表头。
- 对空输入、路径不存在、切割大小过大、份数不合理等情况进行校验，并给出友好的错误提示。
- 桌面端支持系统文件选择、拖拽输入、最近目录记忆、任务取消、进度/速度/剩余时间展示、双语界面和友好校验提示。
- 桌面端采用固定尺寸工具窗口，支持顶部栏固定、无可见滚动条但可上下滚动、进度和结果内联展示、长路径结果完整换行。

## 项目结构

```text
ShardCut/
|-- core/              # Rust 核心库：切割、合并、校验、manifest
|-- cli/               # 命令行工具
|-- desktop/           # Tauri + React 桌面端
|-- Cargo.toml         # Rust workspace
`-- README.md          # 英文 README
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

## 多平台绿色版构建与发布

ShardCut 当前发布绿色版，也就是免安装版本，不生成安装器。本地构建使用 Tauri 的 no-bundle 模式：

```powershell
cd desktop
npm run build:portable
```

构建完成后，可执行文件位于 `target/release/`。Windows 文件为：

```text
target/release/shardcut-desktop.exe
```

如果旧版程序仍在运行，Windows 可能会阻止构建覆盖该 exe。重新打包前请先关闭 ShardCut。

GitHub Actions 会为 Windows、macOS 和 Linux 构建绿色版包。普通 push 和 pull request 会上传 workflow artifacts 供测试下载；推送 `v*` 格式的版本标签时，还会自动创建 GitHub Release，并上传以下面向用户下载的文件：

- `ShardCut-windows-portable.zip`
- `ShardCut-macos-portable.tar.gz`
- `ShardCut-linux-portable.tar.gz`

发布公开版本：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

用户应从仓库的 GitHub Releases 页面下载正式版本。

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

## 后续计划

后续优化和待办项记录在 [ROADMAP.md](ROADMAP.md)。

## 当前范围

ShardCut `0.1.0` 仅处理本地单文件切割与合并，不包含目录打包、压缩、加密、云同步或网络传输。当前优先保证大文件处理的稳定性、可恢复性、清晰校验、强 SHA-256 校验，以及干净顺手的桌面端工作流。
