//! Super-resolution engine abstraction. The rest of the app only talks to
//! [`UpscaleEngine`], so another backend (Real-ESRGAN, ...) can be added by
//! implementing the trait next to [`waifu2x::Waifu2xEngine`].

pub mod models;
pub mod plan;
pub mod waifu2x;

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::error::AppResult;
use crate::settings::{Style, Threads};
use models::ModelCapabilities;
use plan::EnginePlan;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub found: bool,
    pub dir: String,
    pub version: Option<String>,
    pub models: Vec<ModelCapabilities>,
}

pub struct EngineJob<'a> {
    pub input: &'a Path,
    /// Always a PNG; the pipeline re-encodes it to the requested format.
    pub output: &'a Path,
    pub style: Style,
    pub plan: EnginePlan,
    pub gpu: Option<i32>,
    pub tile_size: u32,
    pub tta: bool,
    pub threads: Threads,
    /// Directory mode: `input`/`output` are folders and this many output files are expected.
    pub expect_outputs: Option<usize>,
}

#[derive(Debug, Clone)]
pub enum EngineEvent {
    /// The engine initialised its compute device and started processing.
    DeviceReady(String),
    /// A raw line of engine output.
    Log(String),
}

pub type EventSink<'a> = &'a (dyn Fn(EngineEvent) + Send + Sync);
pub type EngineFuture<'a> = Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>>;

pub trait UpscaleEngine: Send + Sync {
    fn status(&self) -> EngineStatus;
    fn capabilities(&self, style: Style) -> ModelCapabilities;
    /// Runs one job to completion. Must stop promptly and clean up its process
    /// when `cancel` fires, returning `ErrorCode::Cancelled`.
    fn run<'a>(&'a self, job: EngineJob<'a>, events: EventSink<'a>, cancel: &'a CancellationToken) -> EngineFuture<'a>;
}
