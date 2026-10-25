use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use super::models::{scan_all, scan_style, ModelCapabilities};
use super::{EngineEvent, EngineFuture, EngineJob, EngineStatus, EventSink, UpscaleEngine};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::settings::Style;

pub const EXE_NAME: &str = "waifu2x-ncnn-vulkan.exe";
const MAX_LOG_LINES: usize = 500;

pub struct Waifu2xEngine {
    dir: PathBuf,
}

impl Waifu2xEngine {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn exe(&self) -> PathBuf {
        self.dir.join(EXE_NAME)
    }

    fn version(&self) -> Option<String> {
        std::fs::read_to_string(self.dir.join("ENGINE_VERSION")).ok().map(|v| v.trim().to_string())
    }

    pub fn build_args(&self, job: &EngineJob<'_>) -> Vec<String> {
        let mut args = vec![
            "-i".into(),
            job.input.to_string_lossy().into_owned(),
            "-o".into(),
            job.output.to_string_lossy().into_owned(),
            "-n".into(),
            job.plan.noise.to_string(),
            "-s".into(),
            job.plan.engine_scale.to_string(),
            "-t".into(),
            job.tile_size.to_string(),
            "-m".into(),
            self.dir.join(job.style.model_dir()).to_string_lossy().into_owned(),
            "-j".into(),
            format!("{}:{}:{}", job.threads.load, job.threads.proc, job.threads.save),
            "-f".into(),
            "png".into(),
            "-v".into(),
        ];
        if let Some(gpu) = job.gpu {
            args.push("-g".into());
            args.push(gpu.to_string());
        }
        if job.tta {
            args.push("-x".into());
        }
        args
    }

    async fn run_inner(&self, job: EngineJob<'_>, events: EventSink<'_>, cancel: &CancellationToken) -> AppResult<()> {
        let exe = self.exe();
        if !exe.is_file() {
            return Err(AppError::new(ErrorCode::EngineMissing, format!("{} not found", exe.display())));
        }
        let args = self.build_args(&job);
        events(EngineEvent::Log(format!("$ {} {}", EXE_NAME, args.join(" "))));

        let mut cmd = Command::new(&exe);
        cmd.args(&args)
            .current_dir(&self.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(crate::tuning::process_flags());

        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::new(ErrorCode::EngineFailed, format!("could not start engine: {e}")))?;
        let stderr = child.stderr.take().expect("stderr is piped");

        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let reader = {
            let lines = lines.clone();
            async move {
                let mut reader = BufReader::new(stderr).split(b'\n');
                let mut device_announced = false;
                while let Ok(Some(raw)) = reader.next_segment().await {
                    let line = String::from_utf8_lossy(&raw).trim_end().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if !device_announced && line.starts_with('[') {
                        if let Some(name) = parse_device_line(&line) {
                            device_announced = true;
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

        let lines = lines.lock().unwrap().clone();
        let output_ok = match job.expect_outputs {
            Some(n) => std::fs::read_dir(job.output).map(|d| d.count() >= n).unwrap_or(false),
            None => job.output.is_file(),
        };
        classify(&lines, status.code(), output_ok)
    }
}

/// `[0 NVIDIA GeForce GTX 1650]  queueC=...` -> `NVIDIA GeForce GTX 1650`
fn parse_device_line(line: &str) -> Option<String> {
    let inner = line.strip_prefix('[')?.split(']').next()?;
    let (_, name) = inner.split_once(' ')?;
    Some(name.trim().to_string())
}

/// Turns engine output into a precise error. waifu2x-ncnn-vulkan exits with
/// code 0 after many failures (undecodable input, lost GPU device: it then
/// writes a blank image), so any reported failure is fatal and success also
/// requires the output file to exist.
pub fn classify(lines: &[String], exit_code: Option<i32>, output_exists: bool) -> AppResult<()> {
    let find = |pred: &dyn Fn(&str) -> bool| lines.iter().find(|l| pred(&l.to_ascii_lowercase())).cloned();

    type Check<'a> = (ErrorCode, &'a dyn Fn(&str) -> bool);
    let checks: [Check; 8] = [
        (ErrorCode::GpuInvalid, &|l| l.contains("invalid gpu device")),
        (ErrorCode::GpuOutOfMemory, &|l| {
            l.contains("out of memory") || l.contains("out_of_device_memory") || l.contains("vkallocatememory failed")
        }),
        (ErrorCode::VulkanUnavailable, &|l| {
            l.contains("vkcreateinstance failed")
                || l.contains("vkenumeratephysicaldevices failed")
                || l.contains("no vulkan device")
                || l.contains("vkcreatedevice failed")
        }),
        (ErrorCode::ModelMissing, &|l| {
            l.contains("unknown model dir type") || (l.contains("fopen") && (l.contains(".param") || l.contains(".bin")))
        }),
        (ErrorCode::DecodeFailed, &|l| l.contains("decode image") && l.contains("failed")),
        (ErrorCode::EncodeFailed, &|l| l.contains("encode image") && l.contains("failed")),
        (ErrorCode::GpuDeviceLost, &|l| l.starts_with("vk") && l.contains("failed")),
        (ErrorCode::EngineFailed, &|l| l.contains("failed")),
    ];

    for (code, pred) in checks {
        if let Some(line) = find(pred) {
            return Err(AppError::new(code, line));
        }
    }
    if exit_code == Some(0) && output_exists {
        return Ok(());
    }
    let tail = lines.iter().rev().take(4).rev().cloned().collect::<Vec<_>>().join("
");
    let detail = match exit_code {
        Some(0) => format!("engine finished without writing an output file
{tail}"),
        Some(c) => format!("engine exited with code {c} (0x{:08X})
{tail}", c as u32),
        None => format!("engine was terminated
{tail}"),
    };
    Err(AppError::new(ErrorCode::EngineFailed, detail))
}

impl UpscaleEngine for Waifu2xEngine {
    fn status(&self) -> EngineStatus {
        EngineStatus {
            id: "waifu2x-ncnn-vulkan",
            name: "waifu2x (ncnn / Vulkan)",
            found: self.exe().is_file(),
            dir: self.dir.to_string_lossy().into_owned(),
            version: self.version(),
            models: scan_all(&self.dir),
        }
    }

    fn capabilities(&self, style: Style) -> ModelCapabilities {
        scan_style(&self.dir, style)
    }

    fn run<'a>(&'a self, job: EngineJob<'a>, events: EventSink<'a>, cancel: &'a CancellationToken) -> EngineFuture<'a> {
        Box::pin(self.run_inner(job, events, cancel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use crate::engine::plan::EnginePlan;
    use crate::settings::Threads;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_device_name() {
        assert_eq!(
            parse_device_line("[0 NVIDIA GeForce GTX 1650]  queueC=2[8]  queueG=0[16]").as_deref(),
            Some("NVIDIA GeForce GTX 1650")
        );
        assert_eq!(parse_device_line("not a device"), None);
    }

    #[test]
    fn classifies_known_failures() {
        let gpu = classify(&lines(&["[0 GPU]  queueC=2", "invalid gpu device"]), Some(-1), false);
        assert_eq!(gpu.unwrap_err().code, ErrorCode::GpuInvalid);
        // Exit code 0 but decode failed: must still be an error.
        let dec = classify(&lines(&["decode image C:\\a b\\x.png failed"]), Some(0), false);
        assert_eq!(dec.unwrap_err().code, ErrorCode::DecodeFailed);
        let model = classify(&lines(&["unknown model dir type"]), Some(-1), false);
        assert_eq!(model.unwrap_err().code, ErrorCode::ModelMissing);
        let oom = classify(&lines(&["vkAllocateMemory failed -2"]), Some(-1), false);
        assert_eq!(oom.unwrap_err().code, ErrorCode::GpuOutOfMemory);
        let vk = classify(&lines(&["vkCreateInstance failed -9"]), Some(-1), false);
        assert_eq!(vk.unwrap_err().code, ErrorCode::VulkanUnavailable);
        // Device lost: the engine still writes a (blank) file and exits 0.
        let lost = classify(&lines(&["[0 GPU]  queueC=2", "vkQueueSubmit failed -4", "a.png -> b.png done"]), Some(0), true);
        assert_eq!(lost.unwrap_err().code, ErrorCode::GpuDeviceLost);
    }

    #[test]
    fn success_requires_output() {
        let ok = lines(&["[0 GPU]  bugsbn1=0  bugbilz=0", "a.png -> b.png done"]);
        assert!(classify(&ok, Some(0), true).is_ok());
        assert_eq!(classify(&ok, Some(0), false).unwrap_err().code, ErrorCode::EngineFailed);
        let crash = classify(&ok, Some(-1073741819), false).unwrap_err();
        assert!(crash.detail.contains("C0000005"));
    }

    #[test]
    fn builds_arguments() {
        let engine = Waifu2xEngine::new(PathBuf::from(r"C:\Program Files\Aoze\engine"));
        let job = EngineJob {
            input: Path::new(r"C:\my pics\in.png"),
            output: Path::new(r"C:\tmp\out.png"),
            style: Style::Photo,
            plan: EnginePlan { engine_scale: 4, noise: -1, needs_resize: false },
            gpu: Some(-1),
            tile_size: 0,
            tta: true,
            threads: Threads::default(),
            expect_outputs: None,
        };
        let args = engine.build_args(&job);
        let joined = args.join("|");
        assert!(joined.contains(r"-i|C:\my pics\in.png"));
        assert!(joined.contains("-n|-1|-s|4"));
        assert!(joined.contains(r"-m|C:\Program Files\Aoze\engine\models-upconv_7_photo"));
        assert!(joined.contains("-j|1:2:2"));
        assert!(joined.ends_with("-g|-1|-x"));
    }
}
