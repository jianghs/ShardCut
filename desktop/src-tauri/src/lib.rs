use shardcut_core::{
    merge_file, split_file, verify_manifest, MergeOptions, SplitMode, SplitOptions,
};
use std::path::PathBuf;

#[tauri::command]
fn split(
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
    let manifest = split_file(SplitOptions {
        input_path: PathBuf::from(input_path),
        output_dir: PathBuf::from(output_dir),
        mode: split_mode,
        overwrite,
    })
    .map_err(|error| error.to_string())?;
    serde_json::to_value(manifest).map_err(|error| error.to_string())
}

#[tauri::command]
fn merge(manifest_path: String, output_path: String, overwrite: bool) -> Result<String, String> {
    merge_file(MergeOptions {
        manifest_path: PathBuf::from(manifest_path),
        output_path: PathBuf::from(output_path),
        overwrite,
    })
    .map(|path| path.display().to_string())
    .map_err(|error| error.to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![split, merge, verify])
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
