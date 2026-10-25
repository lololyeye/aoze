//! Anime clip clean-up with Real-ESRGAN's video model (realesr-animevideov3,
//! realesrgan-ncnn-vulkan). Chosen over waifu2x for anime after measuring both
//! on real footage: cleaner, sharper line art, lighter in VRAM
//! (docs/VIDEO_ENGINE.md). Its extra shimmer is removed afterwards by temporal
//! stabilisation in the clip pipeline.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::engine::waifu2x::classify;
use crate::engine::EngineEvent;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::Threads;

pub const EXE_NAME: &str = "realesrgan-ncnn-vulkan.exe";
pub const MODEL: &str = "realesr-animevideov3";
const MAX_LOG_LINES: usize = 300;

pub struct Esrgan {
    dir: PathBuf,
}

/// One folder pass.
pub struct EsrganJob<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    /// Native model scale: 2, 3 or 4.
    pub scale: u32,
    pub gpu: Option<i32>,
    /// 0 = automatic.
    pub tile_size: u32,
    pub threads: Threads,
    pub tta: bool,
    pub expect_outputs: usize,
}

/// Smallest native scale reaching `factor` (the rest is a Lanczos resize).
pub fn native_scale(factor: f32) -> u32 {
    if factor <= 2.0 + 1e-3 {
        2
    } else if factor <= 3.0 + 1e-3 {
        3
    } else {
        4
    }
}

impl Esrgan {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn found(&self) -> bool {
        self.dir.join(EXE_NAME).is_file() && [2, 3, 4].iter().all(|s| self.dir.join("models").join(format!("{MODEL}-x{s}.bin")).is_file())
    }

    fn args(&self, job: &EsrganJob<'_>) -> Vec<String> {
        let mut a = vec![
            "-i".into(),
            job.input.to_string_lossy().into_owned(),
            "-o".into(),
            job.output.to_string_lossy().into_owned(),
            "-n".into(),
            MODEL.into(),
            "-s".into(),
            job.scale.to_string(),
            "-m".into(),
            self.dir.join("models").to_string_lossy().into_owned(),
            "-t".into(),
            job.tile_size.to_string(),
            "-j".into(),
            format!("{}:{}:{}", job.threads.load, job.threads.proc, job.threads.save),
            "-f".into(),
            "png".into(),
        ];
        if let Some(g) = job.gpu {
            a.push("-g".into());
            a.push(g.to_string());
        }
        if job.tta {
            a.push("-x".into());
        }
        a
    }

    /// Upscales every image of `input` into `output` (same file names, PNG).
    pub async fn run(&self, job: &EsrganJob<'_>, events: &(dyn Fn(EngineEvent) + Send + Sync), cancel: &CancellationToken) -> AppResult<()> {
        if !self.found() {
            return Err(AppError::new(ErrorCode::EngineMissing, format!("{} or its {MODEL} models not found", self.dir.join(EXE_NAME).display())));
        }
        std::fs::create_dir_all(job.output)?;
        let args = self.args(job);
        events(EngineEvent::Log(format!("$ {EXE_NAME} {}", args.join(" "))));
        let mut cmd = Command::new(self.dir.join(EXE_NAME));
        cmd.args(&args).current_dir(&self.dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(crate::tuning::process_flags());
        let mut child = cmd.spawn().map_err(|e| AppError::new(ErrorCode::EngineFailed, format!("could not start {EXE_NAME}: {e}")))?;
        let stderr = child.stderr.take().expect("stderr is piped");
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let reader = {
            let lines = lines.clone();
            async move {
                let mut reader = BufReader::new(stderr).split(b'\n');
                let mut announced = false;
                while let Ok(Some(raw)) = reader.next_segment().await {
                    let line = String::from_utf8_lossy(&raw).trim_end().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    // "[0 NVIDIA GeForce GTX 1650]  queueC=..." -> device ready.
                    if !announced && line.starts_with('[') {
                        if let Some(name) = line.strip_prefix('[').and_then(|l| l.split(']').next()).and_then(|l| l.split_once(' ')).map(|(_, n)| n.trim().to_string()) {
                            announced = true;
                            events(EngineEvent::DeviceReady(name));
                        }
                    }
                    events(EngineEvent::Log(line.clone()));
                    let mut l = lines.lock().unwrap();
                    if l.len() < MAX_LOG_LINES {
                        l.push(line);
                    }
                }
            }
        };
        let status = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                return Err(AppError::cancelled());
            }
            (status, _) = async { tokio::join!(child.wait(), reader) } => status?,
        };
        let written = std::fs::read_dir(job.output).map(|d| d.count()).unwrap_or(0);
        let lines = lines.lock().unwrap().clone();
        classify(&lines, status.code(), written >= job.expect_outputs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales() {
        assert_eq!(native_scale(1.0), 2);
        assert_eq!(native_scale(1.6), 2);
        assert_eq!(native_scale(2.0), 2);
        assert_eq!(native_scale(3.0), 3);
        assert_eq!(native_scale(4.0), 4);
    }
}
