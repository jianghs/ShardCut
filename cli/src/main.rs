use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use shardcut_core::{
    merge_file, split_file, verify_manifest, MergeOptions, SplitMode, SplitOptions,
};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "shardcut",
    version,
    about = "Fast cross-platform file splitter and merger"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Split {
        file: PathBuf,
        #[arg(long, conflicts_with_all = ["parts", "lines"])]
        size: Option<String>,
        #[arg(long, conflicts_with_all = ["size", "lines"])]
        parts: Option<u32>,
        #[arg(long, conflicts_with_all = ["size", "parts"])]
        lines: Option<u64>,
        #[arg(long)]
        repeat_header: bool,
        #[arg(long, value_name = "DIR")]
        out: PathBuf,
        #[arg(long)]
        overwrite: bool,
    },
    Merge {
        manifest: PathBuf,
        #[arg(long, value_name = "FILE_OR_DIR")]
        out: PathBuf,
        #[arg(long)]
        overwrite: bool,
    },
    Verify {
        manifest: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Split {
            file,
            size,
            parts,
            lines,
            repeat_header,
            out,
            overwrite,
        } => {
            let mode = match (size, parts, lines) {
                (Some(size), None, None) => SplitMode::BySize {
                    bytes: parse_size(&size)?,
                },
                (None, Some(count), None) => SplitMode::ByParts { count },
                (None, None, Some(lines_per_part)) => SplitMode::ByLines {
                    lines_per_part,
                    repeat_header,
                },
                _ => bail!("choose exactly one split mode: --size, --parts, or --lines"),
            };
            let manifest = split_file(SplitOptions {
                input_path: file,
                output_dir: out,
                mode,
                overwrite,
            })?;
            println!("{}", serde_json::to_string_pretty(&manifest)?);
        }
        Command::Merge {
            manifest,
            out,
            overwrite,
        } => {
            let output = merge_file(MergeOptions {
                manifest_path: manifest,
                output_path: out,
                overwrite,
            })?;
            println!("merged: {}", output.display());
        }
        Command::Verify { manifest } => {
            let result = verify_manifest(manifest)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            if !result.ok {
                std::process::exit(2);
            }
        }
    }
    Ok(())
}

fn parse_size(input: &str) -> Result<u64> {
    let trimmed = input.trim();
    let split_at = trimmed
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(trimmed.len());
    let (number, unit) = trimmed.split_at(split_at);
    if number.is_empty() {
        bail!("size must start with a number");
    }
    let value: u64 = number.parse()?;
    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "k" | "kb" => 1024,
        "m" | "mb" => 1024_u64.pow(2),
        "g" | "gb" => 1024_u64.pow(3),
        "t" | "tb" => 1024_u64.pow(4),
        other => bail!("unsupported size unit: {other}"),
    };
    Ok(value * multiplier)
}
