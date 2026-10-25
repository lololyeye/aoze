//! Vulkan device discovery. The loader (vulkan-1.dll) is loaded dynamically so
//! a machine without Vulkan reports a clear status instead of failing to start.
//! Devices are listed in Vulkan enumeration order, which is the order ncnn uses
//! for waifu2x's `-g <index>`.

use ash::vk;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub kind: GpuKind,
    pub vram_bytes: u64,
    pub api_version: String,
    pub driver_version: String,
    pub vendor_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuKind {
    Discrete,
    Integrated,
    Virtual,
    Cpu,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VulkanStatus {
    pub available: bool,
    pub instance_version: Option<String>,
    pub gpus: Vec<GpuInfo>,
    /// Index waifu2x picks when no GPU is forced.
    pub default_gpu: Option<u32>,
    pub error: Option<String>,
}

fn version_string(v: u32) -> String {
    format!("{}.{}.{}", vk::api_version_major(v), vk::api_version_minor(v), vk::api_version_patch(v))
}

fn driver_string(vendor: u32, v: u32) -> String {
    // NVIDIA packs its driver version differently from the Vulkan convention.
    if vendor == 0x10DE {
        format!("{}.{}", (v >> 22) & 0x3ff, (v >> 14) & 0xff)
    } else {
        version_string(v)
    }
}

fn kind(t: vk::PhysicalDeviceType) -> GpuKind {
    match t {
        vk::PhysicalDeviceType::DISCRETE_GPU => GpuKind::Discrete,
        vk::PhysicalDeviceType::INTEGRATED_GPU => GpuKind::Integrated,
        vk::PhysicalDeviceType::VIRTUAL_GPU => GpuKind::Virtual,
        vk::PhysicalDeviceType::CPU => GpuKind::Cpu,
        _ => GpuKind::Other,
    }
}

/// Same preference as ncnn::get_default_gpu_index: discrete, integrated, virtual, then first.
fn default_gpu(gpus: &[GpuInfo]) -> Option<u32> {
    [GpuKind::Discrete, GpuKind::Integrated, GpuKind::Virtual]
        .iter()
        .find_map(|k| gpus.iter().find(|g| g.kind == *k))
        .or(gpus.first())
        .map(|g| g.index)
}

pub fn detect() -> VulkanStatus {
    match enumerate() {
        Ok((instance_version, gpus)) => {
            let default_gpu = default_gpu(&gpus);
            let error = gpus.is_empty().then(|| "no Vulkan physical device found".to_string());
            VulkanStatus { available: !gpus.is_empty(), instance_version, gpus, default_gpu, error }
        }
        Err(e) => VulkanStatus { available: false, instance_version: None, gpus: vec![], default_gpu: None, error: Some(e) },
    }
}

fn enumerate() -> Result<(Option<String>, Vec<GpuInfo>), String> {
    // SAFETY: loading the system Vulkan loader; failure is reported, not fatal.
    let entry = unsafe { ash::Entry::load() }.map_err(|e| format!("Vulkan loader not available: {e}"))?;
    let instance_version = unsafe { entry.try_enumerate_instance_version() }.ok().flatten().map(version_string);

    let app = vk::ApplicationInfo::default().application_name(c"Aoze").api_version(vk::make_api_version(0, 1, 0, 0));
    let info = vk::InstanceCreateInfo::default().application_info(&app);
    // SAFETY: valid create info, instance destroyed below.
    let instance = unsafe { entry.create_instance(&info, None) }.map_err(|e| format!("vkCreateInstance failed: {e}"))?;

    let result = (|| {
        // SAFETY: instance is alive for the whole closure.
        let devices = unsafe { instance.enumerate_physical_devices() }
            .map_err(|e| format!("vkEnumeratePhysicalDevices failed: {e}"))?;
        let gpus = devices
            .iter()
            .enumerate()
            .map(|(i, &pd)| {
                let props = unsafe { instance.get_physical_device_properties(pd) };
                let mem = unsafe { instance.get_physical_device_memory_properties(pd) };
                let vram_bytes = mem
                    .memory_heaps_as_slice()
                    .iter()
                    .filter(|h| h.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL))
                    .map(|h| h.size)
                    .max()
                    .unwrap_or(0);
                let name = props
                    .device_name_as_c_str()
                    .map(|c| c.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| format!("GPU {i}"));
                GpuInfo {
                    index: i as u32,
                    name,
                    kind: kind(props.device_type),
                    vram_bytes,
                    api_version: version_string(props.api_version),
                    driver_version: driver_string(props.vendor_id, props.driver_version),
                    vendor_id: props.vendor_id,
                }
            })
            .collect::<Vec<_>>();
        Ok(gpus)
    })();

    // SAFETY: no objects derived from the instance outlive this call.
    unsafe { instance.destroy_instance(None) };
    result.map(|gpus| (instance_version, gpus))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(index: u32, kind: GpuKind) -> GpuInfo {
        GpuInfo {
            index,
            name: String::new(),
            kind,
            vram_bytes: 0,
            api_version: String::new(),
            driver_version: String::new(),
            vendor_id: 0,
        }
    }

    #[test]
    fn default_prefers_discrete() {
        let gpus = vec![gpu(0, GpuKind::Integrated), gpu(1, GpuKind::Discrete)];
        assert_eq!(default_gpu(&gpus), Some(1));
        assert_eq!(default_gpu(&[gpu(0, GpuKind::Cpu)]), Some(0));
        assert_eq!(default_gpu(&[]), None);
    }

    #[test]
    fn detect_never_panics() {
        let status = detect();
        assert_eq!(status.available, !status.gpus.is_empty());
    }
}
