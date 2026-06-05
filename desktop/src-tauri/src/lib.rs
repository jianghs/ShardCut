use serde::Serialize;
use shardcut_core::{
    merge_file_with_progress_and_cancellation, split_file_with_progress_and_cancellation,
    verify_manifest, CancellationToken, MergeOptions, SplitMode, SplitOptions, TaskProgress,
};
use std::collections::HashMap;
use std::path::PathBuf;
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

#[tauri::command]
fn split(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    task_id: String,
    input_path: String,
    output_dir: String,
    mode: String,
    value: String,
    repeat_header: bool,
    overwrite: bool,
) -> Result<serde_json::Value, String> {
    let split_mode = match mode.as_str() {
        "size" => SplitMode::BySize {
            bytes: parse_size(&value).map_err(|error| error.to_string())?,
        },
        "parts" => SplitMode::ByParts {
            count: value.parse::<u32>().map_err(|error| error.to_string())?,
        },
        "lines" => SplitMode::ByLines {
            lines_per_part: value.parse::<u64>().map_err(|error| error.to_string())?,
            repeat_header,
        },
        _ => return Err("unknown split mode".to_string()),
    };
    let cancellation = CancellationToken::new();
    state
        .tasks
        .lock()
        .map_err(|_| "task state is unavailable".to_string())?
        .insert(task_id.clone(), cancellation.clone());
    let emit_task_id = task_id.clone();
    let result = split_file_with_progress_and_cancellation(
        SplitOptions {
            input_path: PathBuf::from(input_path),
            output_dir: PathBuf::from(output_dir),
            mode: split_mode,
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
    );
    state
        .tasks
        .lock()
        .map_err(|_| "task state is unavailable".to_string())?
        .remove(&task_id);
    let manifest = result.map_err(|error| error.to_string())?;
    serde_json::to_value(manifest).map_err(|error| error.to_string())
}

#[tauri::command]
fn merge(
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
        .map_err(|_| "task state is unavailable".to_string())?
        .insert(task_id.clone(), cancellation.clone());
    let emit_task_id = task_id.clone();
    let result = merge_file_with_progress_and_cancellation(
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
    );
    state
        .tasks
        .lock()
        .map_err(|_| "task state is unavailable".to_string())?
        .remove(&task_id);
    result
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<(), String> {
    let tasks = state
        .tasks
        .lock()
        .map_err(|_| "task state is unavailable".to_string())?;
    match tasks.get(&task_id) {
        Some(cancellation) => {
            cancellation.cancel();
            Ok(())
        }
        None => Err("task is not running".to_string()),
    }
}

#[tauri::command]
fn verify(manifest_path: String) -> Result<serde_json::Value, String> {
    let result =
        verify_manifest(PathBuf::from(manifest_path)).map_err(|error| error.to_string())?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            tasks: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![split, merge, verify, cancel_task])
        .run(tauri::generate_context!())
        .expect("error while running ShardCut");
}

fn parse_size(input: &str) -> Result<u64, &'static str> {
    let trimmed = input.trim();
    let split_at = trimmed
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(trimmed.len());
    let (number, unit) = trimmed.split_at(split_at);
    let value: u64 = number.parse().map_err(|_| "invalid size number")?;
    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "k" | "kb" => 1024,
        "m" | "mb" => 1024_u64.pow(2),
        "g" | "gb" => 1024_u64.pow(3),
        "t" | "tb" => 1024_u64.pow(4),
        _ => return Err("unsupported size unit"),
    };
    Ok(value * multiplier)
}
