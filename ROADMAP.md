# ShardCut Roadmap

This document tracks planned improvements. Items here are not yet implemented unless they are marked as done.

## Phase 1: Reliability

- [ ] Add large-file benchmark tests for 10GB, 50GB, and 100GB files.
- [x] Add cancellable split and merge tasks.
- [x] Clean up unfinished `.tmp` files after cancellation or failure.
- [x] Show progress, processing speed, and estimated remaining time.
- [ ] Support task recovery from an existing manifest after interruption.
- [ ] Improve user-facing errors for file locks, permission issues, and insufficient disk space.

## Phase 2: Desktop Experience

- [x] Support drag-and-drop input files in the desktop app.
- [x] Add clearable selected-file cards for split input and merge manifests.
- [x] Remember recently used input, output, and manifest directories.
- [x] Move progress and result details into the active workflow area.
- [x] Keep the top navigation/settings bar visible while scrolling.
- [x] Support hidden-but-usable vertical scrolling for fixed-size desktop windows.
- [x] Wrap long result paths, hashes, and part names instead of truncating them.
- [ ] Add a persistent task history view.
- [x] Add an "open output folder" action after split and merge.
- [x] Show manifest and part integrity status on the merge page.
- [ ] Centralize all UI and validation strings for English and Chinese localization.

## Phase 3: Verification Capabilities

- [ ] Export standalone checksum files, such as `.sha256`.

## Phase 4: Release And Productization

- [x] Add GitHub Actions builds for the Windows portable release.
- [x] Document the Windows portable build flow and rebuild caveat for running executables.
- [ ] Automatically generate release archives and changelogs.
- [ ] Add Windows code signing.
- [ ] Add project screenshots and usage GIFs to the README.

## Recommended Next Iteration

- [x] Add progress, speed, and remaining-time display.
- [x] Add cancellation and reliable `.tmp` cleanup.
- [x] Add drag-and-drop input and recent directory memory.
- [x] Add GitHub Actions for the Windows portable release.
- [x] Polish the desktop file picker/dropzone, inline progress/results, and fixed-window scrolling.
- [x] Add open-output-folder actions after successful split and merge.
- [ ] Add desktop screenshots or GIFs to the README.
