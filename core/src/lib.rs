use chrono::{DateTime, Utc};
use memchr::memchr_iter;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp,
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

const BUFFER_SIZE: usize = 16 * 1024 * 1024;
const MANIFEST_VERSION: u32 = 1;
const TOOL_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, thiserror::Error)]
pub enum ShardCutError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("manifest JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid option: {0}")]
    InvalidOption(String),
    #[error("output already exists: {0}")]
    OutputExists(PathBuf),
    #[error("missing part: {0}")]
    MissingPart(PathBuf),
    #[error("corrupted part {path}: expected {expected}, got {actual}")]
    CorruptedPart {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("merged file hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("task was cancelled")]
    Cancelled,
}

pub type Result<T> = std::result::Result<T, ShardCutError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SplitMode {
    BySize {
        bytes: u64,
    },
    ByParts {
        count: u32,
    },
    ByLines {
        lines_per_part: u64,
        repeat_header: bool,
    },
}

#[derive(Debug, Clone)]
pub struct SplitOptions {
    pub input_path: PathBuf,
    pub output_dir: PathBuf,
    pub mode: SplitMode,
    pub overwrite: bool,
}

#[derive(Debug, Clone)]
pub struct MergeOptions {
    pub manifest_path: PathBuf,
    pub output_path: PathBuf,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskPhase {
    Splitting,
    Merging,
    Verifying,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    pub phase: TaskPhase,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current_part: u32,
    pub speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub lines_done: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub missing_parts: Vec<PathBuf>,
    pub corrupted_parts: Vec<PathBuf>,
    pub expected_hash: String,
    pub actual_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartManifest {
    pub index: u32,
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
    pub lines: Option<u64>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineManifest {
    pub total_lines: u64,
    pub lines_per_part: u64,
    pub repeat_header: bool,
    pub header_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub manifest_version: u32,
    pub tool_version: String,
    pub created_at: DateTime<Utc>,
    pub original_file_name: String,
    pub original_size: u64,
    pub original_sha256: String,
    pub split_mode: SplitMode,
    pub status: String,
    pub parts: Vec<PartManifest>,
    pub line_info: Option<LineManifest>,
}

pub fn split_file(options: SplitOptions) -> Result<Manifest> {
    split_file_with_progress(options, |_| {})
}

pub fn split_file_with_progress(
    options: SplitOptions,
    on_progress: impl FnMut(TaskProgress),
) -> Result<Manifest> {
    split_file_with_progress_and_cancellation(options, CancellationToken::new(), on_progress)
}

pub fn split_file_with_progress_and_cancellation(
    options: SplitOptions,
    cancellation: CancellationToken,
    mut on_progress: impl FnMut(TaskProgress),
) -> Result<Manifest> {
    validate_split_options(&options)?;
    fs::create_dir_all(&options.output_dir)?;

    let metadata = fs::metadata(&options.input_path)?;
    let original_size = metadata.len();
    let original_file_name = file_name(&options.input_path)?;
    validate_split_plan(&options.mode, original_size)?;
    let started = Instant::now();

    let manifest = match options.mode {
        SplitMode::BySize { bytes } => split_by_byte_limit(
            &options,
            original_size,
            original_file_name,
            bytes,
            &cancellation,
            &mut on_progress,
        )?,
        SplitMode::ByParts { count } => {
            let bytes = if original_size == 0 {
                1
            } else {
                original_size.div_ceil(u64::from(count))
            };
            split_by_byte_limit(
                &options,
                original_size,
                original_file_name,
                bytes,
                &cancellation,
                &mut on_progress,
            )?
        }
        SplitMode::ByLines {
            lines_per_part,
            repeat_header,
        } => split_by_lines(
            &options,
            original_size,
            original_file_name,
            lines_per_part,
            repeat_header,
            &cancellation,
            &mut on_progress,
        )?,
    };

    let manifest_path = options
        .output_dir
        .join(format!("{}.manifest.json", manifest.original_file_name));
    write_json(&manifest_path, &manifest, options.overwrite)?;
    emit_progress(
        &mut on_progress,
        TaskPhase::Completed,
        original_size,
        original_size,
        manifest.parts.len() as u32,
        started,
        None,
    );
    Ok(manifest)
}

pub fn merge_file(options: MergeOptions) -> Result<PathBuf> {
    merge_file_with_progress(options, |_| {})
}

pub fn merge_file_with_progress(
    options: MergeOptions,
    on_progress: impl FnMut(TaskProgress),
) -> Result<PathBuf> {
    merge_file_with_progress_and_cancellation(options, CancellationToken::new(), on_progress)
}

pub fn merge_file_with_progress_and_cancellation(
    options: MergeOptions,
    cancellation: CancellationToken,
    mut on_progress: impl FnMut(TaskProgress),
) -> Result<PathBuf> {
    let manifest = read_manifest(&options.manifest_path)?;
    let output_path = resolve_merge_output(&options.output_path, &manifest);
    ensure_output_allowed(&output_path, options.overwrite)?;
    let started = Instant::now();

    let manifest_dir = options
        .manifest_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let tmp_path = tmp_path_for(&output_path);
    ensure_output_allowed(&tmp_path, true)?;
    let mut tmp_guard = TempOutput::new(tmp_path);

    let mut writer = BufWriter::with_capacity(BUFFER_SIZE, File::create(tmp_guard.path())?);
    let mut merged_hasher = Sha256::new();
    let mut bytes_done = 0u64;

    for part in &manifest.parts {
        check_cancelled(&cancellation)?;
        let part_path = manifest_dir.join(&part.file_name);
        if !part_path.exists() {
            return Err(ShardCutError::MissingPart(part_path));
        }
        let skip_prefix = repeated_header_to_skip(&manifest, part.index);
        let actual = copy_part_for_merge(
            &part_path,
            &mut writer,
            &mut merged_hasher,
            skip_prefix,
            |written| {
                bytes_done += written;
                emit_progress(
                    &mut on_progress,
                    TaskPhase::Merging,
                    bytes_done,
                    manifest.original_size,
                    part.index,
                    started,
                    None,
                );
            },
            &cancellation,
        )?;
        check_cancelled(&cancellation)?;
        if actual != part.sha256 {
            return Err(ShardCutError::CorruptedPart {
                path: part_path,
                expected: part.sha256.clone(),
                actual,
            });
        }
    }

    check_cancelled(&cancellation)?;
    writer.flush()?;
    drop(writer);
    tmp_guard.commit(&output_path)?;

    let actual_hash = hex_digest(merged_hasher.finalize());
    if actual_hash != manifest.original_sha256 {
        return Err(ShardCutError::HashMismatch {
            expected: manifest.original_sha256,
            actual: actual_hash,
        });
    }

    emit_progress(
        &mut on_progress,
        TaskPhase::Completed,
        manifest.original_size,
        manifest.original_size,
        manifest.parts.len() as u32,
        started,
        None,
    );
    Ok(output_path)
}

pub fn verify_manifest<P: AsRef<Path>>(manifest_path: P) -> Result<VerifyResult> {
    let manifest_path = manifest_path.as_ref();
    let manifest = read_manifest(manifest_path)?;
    let manifest_dir = manifest_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let mut missing_parts = Vec::new();
    let mut corrupted_parts = Vec::new();

    for part in &manifest.parts {
        let path = manifest_dir.join(&part.file_name);
        if !path.exists() {
            missing_parts.push(path);
            continue;
        }
        let actual = sha256_file(&path)?;
        if actual != part.sha256 {
            corrupted_parts.push(path);
        }
    }

    Ok(VerifyResult {
        ok: missing_parts.is_empty() && corrupted_parts.is_empty(),
        missing_parts,
        corrupted_parts,
        expected_hash: manifest.original_sha256,
        actual_hash: None,
    })
}

pub fn read_manifest<P: AsRef<Path>>(path: P) -> Result<Manifest> {
    let file = File::open(path)?;
    Ok(serde_json::from_reader(BufReader::new(file))?)
}

fn validate_split_plan(mode: &SplitMode, original_size: u64) -> Result<()> {
    if original_size == 0 {
        return Err(ShardCutError::InvalidOption(
            "empty file cannot be split".into(),
        ));
    }

    match mode {
        SplitMode::BySize { bytes } if *bytes >= original_size => Err(
            ShardCutError::InvalidOption("split would create fewer than two parts".into()),
        ),
        SplitMode::ByParts { count } if u64::from(*count) > original_size => {
            Err(ShardCutError::InvalidOption(
                "parts count exceeds maximum non-empty parts for this file".into(),
            ))
        }
        _ => Ok(()),
    }
}

fn validate_split_options(options: &SplitOptions) -> Result<()> {
    if !options.input_path.is_file() {
        return Err(ShardCutError::InvalidOption(format!(
            "input is not a file: {}",
            options.input_path.display()
        )));
    }
    match options.mode {
        SplitMode::BySize { bytes: 0 } => Err(ShardCutError::InvalidOption(
            "size must be greater than 0".into(),
        )),
        SplitMode::ByParts { count } if count < 2 => Err(ShardCutError::InvalidOption(
            "parts must be at least 2".into(),
        )),
        SplitMode::ByLines {
            lines_per_part: 0, ..
        } => Err(ShardCutError::InvalidOption(
            "lines must be greater than 0".into(),
        )),
        SplitMode::ByLines {
            repeat_header: true,
            ..
        } if !supports_repeated_header(&options.input_path) => Err(ShardCutError::InvalidOption(
            "repeat header is only supported for csv, tsv, and txt files".into(),
        )),
        _ => Ok(()),
    }
}

fn supports_repeated_header(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if matches!(extension.as_str(), "csv" | "tsv" | "txt")
    )
}

fn split_by_byte_limit(
    options: &SplitOptions,
    original_size: u64,
    original_file_name: String,
    byte_limit: u64,
    cancellation: &CancellationToken,
    on_progress: &mut impl FnMut(TaskProgress),
) -> Result<Manifest> {
    let mut reader = BufReader::with_capacity(BUFFER_SIZE, File::open(&options.input_path)?);
    let mut original_hasher = Sha256::new();
    let mut parts = Vec::new();
    let mut buffer = vec![0u8; BUFFER_SIZE];
    let mut part_index = 1;
    let mut bytes_done = 0u64;
    let started = Instant::now();

    if original_size == 0 {
        let part = write_part(
            &options.output_dir,
            &original_file_name,
            part_index,
            &[],
            options.overwrite,
            None,
        )?;
        parts.push(part);
    } else {
        loop {
            check_cancelled(cancellation)?;
            let part_file_name = part_name(&original_file_name, part_index);
            let part_path = options.output_dir.join(&part_file_name);
            ensure_output_allowed(&part_path, options.overwrite)?;
            let tmp_path = tmp_path_for(&part_path);
            let mut tmp_guard = TempOutput::new(tmp_path);
            let mut writer = None;
            let mut part_hasher = Sha256::new();
            let mut part_size = 0u64;

            while part_size < byte_limit {
                check_cancelled(cancellation)?;
                let to_read = cmp::min(buffer.len() as u64, byte_limit - part_size) as usize;
                let read = reader.read(&mut buffer[..to_read])?;
                if read == 0 {
                    break;
                }
                let chunk = &buffer[..read];
                if writer.is_none() {
                    writer = Some(BufWriter::with_capacity(
                        BUFFER_SIZE,
                        File::create(tmp_guard.path())?,
                    ));
                }
                writer
                    .as_mut()
                    .expect("writer initialized before writing")
                    .write_all(chunk)?;
                part_hasher.update(chunk);
                original_hasher.update(chunk);
                part_size += read as u64;
                bytes_done += read as u64;
                emit_progress(
                    on_progress,
                    TaskPhase::Splitting,
                    bytes_done,
                    original_size,
                    part_index,
                    started,
                    None,
                );
            }

            if part_size == 0 {
                break;
            }

            let mut writer = writer.expect("non-empty part must have a writer");
            writer.flush()?;
            drop(writer);
            tmp_guard.commit(&part_path)?;
            parts.push(PartManifest {
                index: part_index,
                file_name: part_file_name,
                size: part_size,
                sha256: hex_digest(part_hasher.finalize()),
                lines: None,
                completed: true,
            });
            part_index += 1;
        }
    }

    Ok(Manifest {
        manifest_version: MANIFEST_VERSION,
        tool_version: TOOL_VERSION.to_string(),
        created_at: Utc::now(),
        original_file_name,
        original_size,
        original_sha256: hex_digest(original_hasher.finalize()),
        split_mode: options.mode.clone(),
        status: "completed".to_string(),
        parts,
        line_info: None,
    })
}

fn split_by_lines(
    options: &SplitOptions,
    original_size: u64,
    original_file_name: String,
    lines_per_part: u64,
    repeat_header: bool,
    cancellation: &CancellationToken,
    on_progress: &mut impl FnMut(TaskProgress),
) -> Result<Manifest> {
    let file = File::open(&options.input_path)?;
    let mut reader = BufReader::with_capacity(BUFFER_SIZE, file);
    let mut original_hasher = Sha256::new();
    let mut header = None;
    let mut parts = Vec::new();
    let mut part_index = 1;
    let mut active = None;
    let mut total_lines = 0;
    let mut body_lines_in_part = 0;
    let mut pending_unterminated_line = false;
    let mut bytes_done = 0u64;
    let started = Instant::now();

    if repeat_header {
        let mut header_bytes = Vec::new();
        let read = reader.read_until(b'\n', &mut header_bytes)?;
        if read > 0 {
            original_hasher.update(&header_bytes);
            total_lines = 1;
            bytes_done += read as u64;
            header = Some(header_bytes);
            emit_progress(
                on_progress,
                TaskPhase::Splitting,
                bytes_done,
                original_size,
                part_index,
                started,
                Some(total_lines),
            );
        }
    }

    let mut buffer = vec![0u8; BUFFER_SIZE];
    loop {
        check_cancelled(cancellation)?;
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        original_hasher.update(chunk);
        bytes_done += read as u64;

        let mut start = 0;
        for newline in memchr_iter(b'\n', chunk) {
            let active_part = ensure_line_part(
                &mut active,
                &options.output_dir,
                &original_file_name,
                part_index,
                header.as_deref(),
                options.overwrite,
            )?;
            let segment = &chunk[start..=newline];
            active_part.write_all(segment)?;
            active_part.lines += 1;
            body_lines_in_part += 1;
            total_lines += 1;
            pending_unterminated_line = false;

            if body_lines_in_part == lines_per_part {
                let completed = active
                    .take()
                    .expect("active line part must exist before finishing")
                    .finish()?;
                parts.push(completed);
                part_index += 1;
                body_lines_in_part = 0;
            }
            start = newline + 1;
        }

        if start < chunk.len() {
            let active_part = ensure_line_part(
                &mut active,
                &options.output_dir,
                &original_file_name,
                part_index,
                header.as_deref(),
                options.overwrite,
            )?;
            active_part.write_all(&chunk[start..])?;
            pending_unterminated_line = true;
        }

        emit_progress(
            on_progress,
            TaskPhase::Splitting,
            bytes_done,
            original_size,
            part_index,
            started,
            Some(total_lines),
        );
    }

    if pending_unterminated_line {
        if let Some(part) = &mut active {
            part.lines += 1;
        }
        total_lines += 1;
    }

    if let Some(part) = active {
        parts.push(part.finish()?);
    } else if original_size == 0 {
        parts.push(write_part(
            &options.output_dir,
            &original_file_name,
            part_index,
            &[],
            options.overwrite,
            Some(0),
        )?);
    } else if repeat_header && header.is_some() && parts.is_empty() {
        parts.push(write_part(
            &options.output_dir,
            &original_file_name,
            part_index,
            header.as_deref().unwrap_or(&[]),
            options.overwrite,
            Some(1),
        )?);
    }

    Ok(Manifest {
        manifest_version: MANIFEST_VERSION,
        tool_version: TOOL_VERSION.to_string(),
        created_at: Utc::now(),
        original_file_name,
        original_size,
        original_sha256: hex_digest(original_hasher.finalize()),
        split_mode: options.mode.clone(),
        status: "completed".to_string(),
        parts,
        line_info: Some(LineManifest {
            total_lines,
            lines_per_part,
            repeat_header,
            header_bytes: header,
        }),
    })
}

struct ActivePart {
    index: u32,
    file_name: String,
    path: PathBuf,
    tmp_path: PathBuf,
    writer: Option<BufWriter<File>>,
    hasher: Sha256,
    size: u64,
    lines: u64,
    committed: bool,
}

impl ActivePart {
    fn open(
        output_dir: &Path,
        original_file_name: &str,
        index: u32,
        header: Option<&[u8]>,
        overwrite: bool,
    ) -> Result<Self> {
        let file_name = part_name(original_file_name, index);
        let path = output_dir.join(&file_name);
        ensure_output_allowed(&path, overwrite)?;
        let tmp_path = tmp_path_for(&path);
        let writer = BufWriter::with_capacity(BUFFER_SIZE, File::create(&tmp_path)?);
        let mut part = Self {
            index,
            file_name,
            path,
            tmp_path,
            writer: Some(writer),
            hasher: Sha256::new(),
            size: 0,
            lines: 0,
            committed: false,
        };
        if let Some(header) = header {
            part.write_all(header)?;
            part.lines = 1;
        }
        Ok(part)
    }

    fn write_all(&mut self, bytes: &[u8]) -> Result<()> {
        self.writer
            .as_mut()
            .expect("active part writer is open")
            .write_all(bytes)?;
        self.hasher.update(bytes);
        self.size += bytes.len() as u64;
        Ok(())
    }

    fn finish(mut self) -> Result<PartManifest> {
        let mut writer = self.writer.take().expect("active part writer is open");
        writer.flush()?;
        drop(writer);
        fs::rename(&self.tmp_path, &self.path)?;
        self.committed = true;
        Ok(PartManifest {
            index: self.index,
            file_name: self.file_name.clone(),
            size: self.size,
            sha256: hex_digest(self.hasher.clone().finalize()),
            lines: Some(self.lines),
            completed: true,
        })
    }
}

impl Drop for ActivePart {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.tmp_path);
        }
    }
}

fn ensure_line_part<'a>(
    active: &'a mut Option<ActivePart>,
    output_dir: &Path,
    original_file_name: &str,
    index: u32,
    header: Option<&[u8]>,
    overwrite: bool,
) -> Result<&'a mut ActivePart> {
    if active.is_none() {
        *active = Some(ActivePart::open(
            output_dir,
            original_file_name,
            index,
            header,
            overwrite,
        )?);
    }
    Ok(active.as_mut().expect("active part just initialized"))
}

fn write_part(
    output_dir: &Path,
    original_file_name: &str,
    index: u32,
    bytes: &[u8],
    overwrite: bool,
    lines: Option<u64>,
) -> Result<PartManifest> {
    let part_file_name = part_name(original_file_name, index);
    let part_path = output_dir.join(&part_file_name);
    ensure_output_allowed(&part_path, overwrite)?;
    let tmp_path = tmp_path_for(&part_path);
    let mut tmp_guard = TempOutput::new(tmp_path);
    let mut writer = BufWriter::with_capacity(BUFFER_SIZE, File::create(tmp_guard.path())?);
    writer.write_all(bytes)?;
    writer.flush()?;
    drop(writer);
    tmp_guard.commit(&part_path)?;
    Ok(PartManifest {
        index,
        file_name: part_file_name,
        size: bytes.len() as u64,
        sha256: sha256_bytes(bytes),
        lines,
        completed: true,
    })
}

fn copy_part_for_merge(
    part_path: &Path,
    writer: &mut BufWriter<File>,
    merged_hasher: &mut Sha256,
    skip_prefix: usize,
    mut on_chunk: impl FnMut(u64),
    cancellation: &CancellationToken,
) -> Result<String> {
    let mut reader = BufReader::with_capacity(BUFFER_SIZE, File::open(part_path)?);
    let mut buffer = vec![0u8; BUFFER_SIZE];
    let mut remaining_skip = skip_prefix;
    let mut part_hasher = Sha256::new();

    loop {
        check_cancelled(cancellation)?;
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        part_hasher.update(&buffer[..read]);
        let start = cmp::min(remaining_skip, read);
        remaining_skip -= start;
        if start < read {
            let chunk = &buffer[start..read];
            writer.write_all(chunk)?;
            merged_hasher.update(chunk);
            on_chunk(chunk.len() as u64);
        }
    }

    Ok(hex_digest(part_hasher.finalize()))
}

fn emit_progress(
    on_progress: &mut impl FnMut(TaskProgress),
    phase: TaskPhase,
    bytes_done: u64,
    bytes_total: u64,
    current_part: u32,
    started: Instant,
    lines_done: Option<u64>,
) {
    let elapsed = started.elapsed().as_secs_f64();
    let speed_bps = if elapsed > 0.0 {
        (bytes_done as f64 / elapsed) as u64
    } else {
        0
    };
    let eta_seconds = if speed_bps > 0 && bytes_total > bytes_done {
        Some((bytes_total - bytes_done).div_ceil(speed_bps))
    } else {
        None
    };
    on_progress(TaskProgress {
        phase,
        bytes_done,
        bytes_total,
        current_part,
        speed_bps,
        eta_seconds,
        lines_done,
    });
}

fn check_cancelled(cancellation: &CancellationToken) -> Result<()> {
    if cancellation.is_cancelled() {
        Err(ShardCutError::Cancelled)
    } else {
        Ok(())
    }
}

struct TempOutput {
    path: PathBuf,
    committed: bool,
}

impl TempOutput {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn commit(&mut self, final_path: &Path) -> Result<()> {
        fs::rename(&self.path, final_path)?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for TempOutput {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn repeated_header_to_skip(manifest: &Manifest, part_index: u32) -> usize {
    if part_index <= 1 {
        return 0;
    }
    match &manifest.line_info {
        Some(line_info) if line_info.repeat_header => line_info
            .header_bytes
            .as_ref()
            .map(|bytes| bytes.len())
            .unwrap_or(0),
        _ => 0,
    }
}

fn write_json(path: &Path, manifest: &Manifest, overwrite: bool) -> Result<()> {
    ensure_output_allowed(path, overwrite)?;
    let tmp_path = tmp_path_for(path);
    let mut tmp_guard = TempOutput::new(tmp_path);
    let file = File::create(tmp_guard.path())?;
    serde_json::to_writer_pretty(BufWriter::new(file), manifest)?;
    tmp_guard.commit(path)?;
    Ok(())
}

fn resolve_merge_output(output_path: &Path, manifest: &Manifest) -> PathBuf {
    if output_path.is_dir() {
        output_path.join(&manifest.original_file_name)
    } else {
        output_path.to_path_buf()
    }
}

fn ensure_output_allowed(path: &Path, overwrite: bool) -> Result<()> {
    if path.exists() && !overwrite {
        return Err(ShardCutError::OutputExists(path.to_path_buf()));
    }
    Ok(())
}

fn part_name(original_file_name: &str, index: u32) -> String {
    format!("{original_file_name}.part{index:03}")
}

fn tmp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("shardcut.tmp");
    path.with_file_name(format!("{file_name}.tmp"))
}

fn file_name(path: &Path) -> Result<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            ShardCutError::InvalidOption(format!("invalid file name: {}", path.display()))
        })
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut reader = BufReader::with_capacity(BUFFER_SIZE, File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; BUFFER_SIZE];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_digest(hasher.finalize())
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn split_by_size_and_merge_round_trips() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("sample.bin");
        fs::write(
            &input_path,
            (0..10_000).map(|n| (n % 251) as u8).collect::<Vec<_>>(),
        )
        .unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path: input_path.clone(),
            output_dir: out_dir.clone(),
            mode: SplitMode::BySize { bytes: 1024 },
            overwrite: false,
        })
        .unwrap();

        assert!(manifest.parts.len() > 1);
        let restored = temp.path().join("restored.bin");
        merge_file(MergeOptions {
            manifest_path: out_dir.join("sample.bin.manifest.json"),
            output_path: restored.clone(),
            overwrite: false,
        })
        .unwrap();
        assert_eq!(fs::read(input_path).unwrap(), fs::read(restored).unwrap());
        assert!(
            verify_manifest(out_dir.join("sample.bin.manifest.json"))
                .unwrap()
                .ok
        );
    }

    #[test]
    fn split_by_parts_and_merge_round_trips() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("data.txt");
        fs::write(&input_path, b"abcdefghijklmnopqrstuvwxyz").unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path: input_path.clone(),
            output_dir: out_dir.clone(),
            mode: SplitMode::ByParts { count: 4 },
            overwrite: false,
        })
        .unwrap();

        assert_eq!(manifest.parts.len(), 4);
        let restored = temp.path().join("restored.txt");
        merge_file(MergeOptions {
            manifest_path: out_dir.join("data.txt.manifest.json"),
            output_path: restored.clone(),
            overwrite: false,
        })
        .unwrap();
        assert_eq!(fs::read(input_path).unwrap(), fs::read(restored).unwrap());
    }

    #[test]
    fn split_by_lines_handles_lf_crlf_and_no_final_newline() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("mixed.log");
        fs::write(&input_path, b"a\nb\r\nc").unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path: input_path.clone(),
            output_dir: out_dir.clone(),
            mode: SplitMode::ByLines {
                lines_per_part: 2,
                repeat_header: false,
            },
            overwrite: false,
        })
        .unwrap();

        assert_eq!(manifest.parts.len(), 2);
        let restored = temp.path().join("restored.log");
        merge_file(MergeOptions {
            manifest_path: out_dir.join("mixed.log.manifest.json"),
            output_path: restored.clone(),
            overwrite: false,
        })
        .unwrap();
        assert_eq!(fs::read(input_path).unwrap(), fs::read(restored).unwrap());
    }

    #[test]
    fn split_by_lines_repeats_header_but_merge_restores_original() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("table.csv");
        fs::write(&input_path, b"id,name\n1,A\n2,B\n3,C\n").unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path: input_path.clone(),
            output_dir: out_dir.clone(),
            mode: SplitMode::ByLines {
                lines_per_part: 2,
                repeat_header: true,
            },
            overwrite: false,
        })
        .unwrap();

        assert_eq!(manifest.parts.len(), 2);
        assert!(fs::read(out_dir.join("table.csv.part002"))
            .unwrap()
            .starts_with(b"id,name\n"));

        let restored = temp.path().join("restored.csv");
        merge_file(MergeOptions {
            manifest_path: out_dir.join("table.csv.manifest.json"),
            output_path: restored.clone(),
            overwrite: false,
        })
        .unwrap();
        assert_eq!(fs::read(input_path).unwrap(), fs::read(restored).unwrap());
    }

    #[test]
    fn split_by_lines_repeat_header_does_not_create_empty_tail_part() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("exact.csv");
        fs::write(&input_path, b"id,name\n1,A\n2,B\n3,C\n4,D\n").unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path: input_path.clone(),
            output_dir: out_dir.clone(),
            mode: SplitMode::ByLines {
                lines_per_part: 2,
                repeat_header: true,
            },
            overwrite: false,
        })
        .unwrap();

        assert_eq!(manifest.parts.len(), 2);
        assert!(!out_dir.join("exact.csv.part003").exists());

        let restored = temp.path().join("restored.csv");
        merge_file(MergeOptions {
            manifest_path: out_dir.join("exact.csv.manifest.json"),
            output_path: restored.clone(),
            overwrite: false,
        })
        .unwrap();
        assert_eq!(fs::read(input_path).unwrap(), fs::read(restored).unwrap());
    }

    #[test]
    fn verify_reports_missing_and_corrupted_parts() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("sample.txt");
        fs::write(&input_path, b"hello world").unwrap();
        let out_dir = temp.path().join("parts");
        split_file(SplitOptions {
            input_path,
            output_dir: out_dir.clone(),
            mode: SplitMode::BySize { bytes: 5 },
            overwrite: false,
        })
        .unwrap();

        let mut part = File::create(out_dir.join("sample.txt.part001")).unwrap();
        part.write_all(b"bad").unwrap();

        let result = verify_manifest(out_dir.join("sample.txt.manifest.json")).unwrap();
        assert!(!result.ok);
        assert_eq!(result.corrupted_parts.len(), 1);
    }

    #[test]
    fn split_by_size_exact_boundary_does_not_leave_empty_tmp() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("exact.bin");
        fs::write(&input_path, vec![7u8; 2048]).unwrap();
        let out_dir = temp.path().join("parts");

        let manifest = split_file(SplitOptions {
            input_path,
            output_dir: out_dir.clone(),
            mode: SplitMode::BySize { bytes: 1024 },
            overwrite: false,
        })
        .unwrap();

        assert_eq!(manifest.parts.len(), 2);
        assert!(!out_dir.join("exact.bin.part003.tmp").exists());
        let tmp_files = fs::read_dir(out_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "tmp"))
            .count();
        assert_eq!(tmp_files, 0);
    }

    #[test]
    fn split_rejects_size_that_would_create_one_part() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("small.bin");
        fs::write(&input_path, vec![1u8; 1024]).unwrap();

        let error = split_file(SplitOptions {
            input_path,
            output_dir: temp.path().join("parts"),
            mode: SplitMode::BySize { bytes: 1024 },
            overwrite: false,
        })
        .unwrap_err();

        assert!(error.to_string().contains("fewer than two parts"));
    }

    #[test]
    fn split_rejects_parts_count_larger_than_non_empty_parts() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("tiny.bin");
        fs::write(&input_path, vec![1u8; 3]).unwrap();

        let error = split_file(SplitOptions {
            input_path,
            output_dir: temp.path().join("parts"),
            mode: SplitMode::ByParts { count: 4 },
            overwrite: false,
        })
        .unwrap_err();

        assert!(error.to_string().contains("maximum non-empty parts"));
    }

    #[test]
    fn repeat_header_rejects_unsupported_extension() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("data.bin");
        fs::write(&input_path, b"id,name\n1,A\n").unwrap();

        let error = split_file(SplitOptions {
            input_path,
            output_dir: temp.path().join("parts"),
            mode: SplitMode::ByLines {
                lines_per_part: 1,
                repeat_header: true,
            },
            overwrite: false,
        })
        .unwrap_err();

        assert!(error.to_string().contains("repeat header"));
    }

    #[test]
    fn cancelled_split_removes_unfinished_tmp_file() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("large.bin");
        fs::write(&input_path, vec![42u8; BUFFER_SIZE + 1024]).unwrap();
        let out_dir = temp.path().join("parts");
        let cancellation = CancellationToken::new();
        let signal = cancellation.clone();

        let error = split_file_with_progress_and_cancellation(
            SplitOptions {
                input_path,
                output_dir: out_dir.clone(),
                mode: SplitMode::BySize {
                    bytes: BUFFER_SIZE as u64,
                },
                overwrite: false,
            },
            cancellation,
            move |progress| {
                if progress.bytes_done > 0 {
                    signal.cancel();
                }
            },
        )
        .unwrap_err();

        assert!(matches!(error, ShardCutError::Cancelled));
        let tmp_files = fs::read_dir(out_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "tmp"))
            .count();
        assert_eq!(tmp_files, 0);
    }

    #[test]
    fn cancelled_merge_removes_unfinished_tmp_file() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("large.bin");
        fs::write(&input_path, vec![7u8; BUFFER_SIZE + 1024]).unwrap();
        let out_dir = temp.path().join("parts");
        split_file(SplitOptions {
            input_path,
            output_dir: out_dir.clone(),
            mode: SplitMode::BySize {
                bytes: BUFFER_SIZE as u64,
            },
            overwrite: false,
        })
        .unwrap();
        let restored = temp.path().join("restored.bin");
        let cancellation = CancellationToken::new();
        let signal = cancellation.clone();

        let error = merge_file_with_progress_and_cancellation(
            MergeOptions {
                manifest_path: out_dir.join("large.bin.manifest.json"),
                output_path: restored.clone(),
                overwrite: false,
            },
            cancellation,
            move |progress| {
                if progress.bytes_done > 0 {
                    signal.cancel();
                }
            },
        )
        .unwrap_err();

        assert!(matches!(error, ShardCutError::Cancelled));
        assert!(!restored.exists());
        assert!(!tmp_path_for(&restored).exists());
    }
}
