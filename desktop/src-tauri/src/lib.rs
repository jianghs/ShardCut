use serde::Serialize;
use shardcut_core::{
    merge_file_with_progress_and_cancellation, split_file_with_progress_and_cancellation,
    verify_manifest, CancellationToken, MergeOptions, SplitMode, SplitOptions, TaskProgress,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct AppState {
    tasks: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    task_id: String,
    progress: TaskProgress,
}

#[derive(Serialize)]
struct ManifestSummary {
    original_file_name: String,
}

#[tauri::command]
async fn split(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    task_id: String,
    input_path: String,
    output_dir: String,
    mode: String,
    value: String,
    repeat_header: bool,
    overwrite: bool,
    max_parts: u32,
) -> Result<serde_json::Value, String> {
    let split_mode = match mode.as_str() {
        "size" => SplitMode::BySize {
            bytes: parse_size(&value)?,
        },
        "parts" => SplitMode::ByParts {
            count: value
                .parse::<u32>()
                .map_err(|e| to_coded("E_INVALID_OPTION", e))?,
        },
        "lines" => SplitMode::ByLines {
            lines_per_part: value
                .parse::<u64>()
                .map_err(|e| to_coded("E_INVALID_OPTION", e))?,
            repeat_header,
        },
        _ => return Err(to_coded("E_UNKNOWN_MODE", "unknown split mode")),
    };
    let cancellation = CancellationToken::new();
    state
        .tasks
        .lock()
        .map_err(|_| to_coded("E_TASK_STATE", "task state is unavailable"))?
        .insert(task_id.clone(), cancellation.clone());
    let emit_task_id = task_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        split_file_with_progress_and_cancellation(
            SplitOptions {
                input_path: PathBuf::from(input_path),
                output_dir: PathBuf::from(output_dir),
                mode: split_mode,
                overwrite,
                max_parts: Some(max_parts),
            },
            cancellation,
            move |progress| {
                let _ = app.emit(
                    "task-progress",
                    ProgressEvent {
                        task_id: emit_task_id.clone(),
                        progress,
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| to_coded("E_TASK_JOIN", e))?;
    state
        .tasks
        .lock()
        .map_err(|_| to_coded("E_TASK_STATE", "task state is unavailable"))?
        .remove(&task_id);
    let manifest = result.map_err(|e| to_coded(e.error_code(), e))?;
    serde_json::to_value(manifest).map_err(|e| to_coded("E_JSON", e))
}

#[tauri::command]
async fn merge(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    task_id: String,
    manifest_path: String,
    output_path: String,
    overwrite: bool,
) -> Result<String, String> {
    let cancellation = CancellationToken::new();
    state
        .tasks
        .lock()
        .map_err(|_| to_coded("E_TASK_STATE", "task state is unavailable"))?
        .insert(task_id.clone(), cancellation.clone());
    let emit_task_id = task_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        merge_file_with_progress_and_cancellation(
            MergeOptions {
                manifest_path: PathBuf::from(manifest_path),
                output_path: PathBuf::from(output_path),
                overwrite,
            },
            cancellation,
            move |progress| {
                let _ = app.emit(
                    "task-progress",
                    ProgressEvent {
                        task_id: emit_task_id.clone(),
                        progress,
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| to_coded("E_TASK_JOIN", e))?;
    state
        .tasks
        .lock()
        .map_err(|_| to_coded("E_TASK_STATE", "task state is unavailable"))?
        .remove(&task_id);
    result
        .map(|path| path.display().to_string())
        .map_err(|e| to_coded(e.error_code(), e))
}

#[tauri::command]
fn cancel_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<(), String> {
    let tasks = state
        .tasks
        .lock()
        .map_err(|_| to_coded("E_TASK_STATE", "task state is unavailable"))?;
    match tasks.get(&task_id) {
        Some(cancellation) => {
            cancellation.cancel();
            Ok(())
        }
        None => Err(to_coded("E_TASK_NOT_RUNNING", "task is not running")),
    }
}

#[tauri::command]
async fn verify(manifest_path: String) -> Result<serde_json::Value, String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || verify_manifest(PathBuf::from(manifest_path)))
            .await
            .map_err(|e| to_coded("E_TASK_JOIN", e))?
            .map_err(|e| to_coded(e.error_code(), e))?;
    serde_json::to_value(result).map_err(|e| to_coded("E_JSON", e))
}

#[tauri::command]
fn manifest_summary(manifest_path: String) -> Result<ManifestSummary, String> {
    let manifest = shardcut_core::read_manifest(PathBuf::from(manifest_path))
        .map_err(|e| to_coded(e.error_code(), e))?;
    Ok(ManifestSummary {
        original_file_name: manifest.original_file_name,
    })
}

#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(PathBuf::from(path))
        .map(|metadata| metadata.len())
        .map_err(|e| to_coded("E_IO", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            tasks: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            split,
            merge,
            verify,
            manifest_summary,
            file_size,
            cancel_task,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShardCut");
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let target = if path.is_dir() {
        path
    } else {
        path.parent().map(PathBuf::from).unwrap_or(path)
    };
    open_in_shell(&target).map_err(|e| to_coded("E_OPEN_FOLDER", e))
}

fn open_in_shell(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| to_coded("E_OPEN_FOLDER", format!("failed to open folder: {error}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| to_coded("E_OPEN_FOLDER", format!("failed to open folder: {error}")))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| to_coded("E_OPEN_FOLDER", format!("failed to open folder: {error}")))?;
    }
    Ok(())
}

fn to_coded(code: &str, error: impl std::fmt::Display) -> String {
    format!("{code}: {error}")
}

fn parse_size(input: &str) -> Result<u64, String> {
    let trimmed = input.trim();
    let split_at = trimmed
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(trimmed.len());
    let (number, unit) = trimmed.split_at(split_at);
    let value: u64 = number
        .parse()
        .map_err(|_| to_coded("E_PARSE_SIZE", "invalid size number"))?;
    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "k" | "kb" => 1024,
        "m" | "mb" => 1024_u64.pow(2),
        "g" | "gb" => 1024_u64.pow(3),
        "t" | "tb" => 1024_u64.pow(4),
        _ => return Err(to_coded("E_PARSE_SIZE", "unsupported size unit")),
    };
    Ok(value * multiplier)
}
