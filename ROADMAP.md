# ShardCut Roadmap

This document tracks planned improvements. Items here are not yet implemented unless they are marked as done.

## Phase 1: Reliability

- [ ] Add large-file benchmark tests for 10GB, 50GB, and 100GB files.
- [ ] Add cancellable split and merge tasks.
- [ ] Clean up unfinished `.tmp` files after cancellation or failure.
- [ ] Show progress, processing speed, and estimated remaining time.
- [ ] Support task recovery from an existing manifest after interruption.
- [ ] Improve user-facing errors for file locks, permission issues, and insufficient disk space.

## Phase 2: Desktop Experience

- [ ] Support drag-and-drop input files in the desktop app.
- [ ] Remember recently used input, output, and manifest directories.
- [ ] Add a persistent task history view.
- [ ] Add an "open output folder" action after split and merge.
- [ ] Show manifest and part integrity status on the merge page.
- [ ] Centralize all UI and validation strings for English and Chinese localization.

## Phase 3: File Capabilities

- [ ] Support directory packaging before splitting.
- [ ] Add optional compression for logs, CSV files, TSV files, and text files.
- [ ] Add optional encrypted parts for sensitive file transfer.
- [ ] Support custom part naming templates.
- [ ] Export standalone checksum files, such as `.sha256`.

## Phase 4: Release And Productization

- [ ] Add GitHub Actions builds for the Windows portable release.
- [ ] Automatically generate release archives and changelogs.
- [ ] Add optional update checks.
- [ ] Add Windows code signing.
- [ ] Add project screenshots and usage GIFs to the README.
- [ ] Create a simple download page or website.

## Recommended Next Iteration

- [ ] Add progress, speed, and remaining-time display.
- [ ] Add cancellation and reliable `.tmp` cleanup.
- [ ] Add drag-and-drop input and recent directory memory.
- [ ] Add GitHub Actions for the Windows portable release.
