# Aoze

**Fast. Simple. Optimized.**

Aoze is a Windows desktop app to upscale, enhance and compress **images, GIFs and short clips**, locally.
Drop a file, pick a size or a preset, click once, done. Aoze hides FFmpeg, codecs, GPUs and models.

*Made for aoxy, by zero.* · Support the project: [ko-fi.com/aoze_support](https://ko-fi.com/aoze_support)

Nothing leaves your computer: no upload, no telemetry, no network access at runtime.

## What it does

| | Image | GIF | Clip |
|---|---|---|---|
| Enlarge (1.6× / 2× / 4×, 8× for images) | waifu2x | Lanczos or waifu2x | Lanczos or waifu2x |
| Enhance | noise reduction (5 levels) | clean-up Low / Medium / High | Sharpen (fast) or Clean-up (waifu2x) |
| Frame rate | — | Original, 15, 24, 30, 50 | Original, 24, 30, 48, 60, 120 (above the source only with Smooth Motion) |
| Motion blur | — | 0–100 % | 0–100 % |
| Compress | Best / Balanced / Smaller / Custom | colours + dithering | CRF (quality) |
| Max file size | yes | yes | yes (x264 two-pass) |
| Output | PNG, JPEG, WebP | GIF (transparency and per-frame timing kept) | MP4 H.264 + original audio |

- **Home**: “What do you want to process?” → *Image / GIF* or *Clip / Video*. Files dropped anywhere go to the right workspace.
- **Presets**: Anime, TikTok edit (clips), High quality, Small file. They change real settings; *Custom* lights up when you change anything.
- **Contextual options**: only what makes sense for the selected file. Technical settings are under *Advanced*.
- **Help**: a “?” next to each option, and a *How Aoze works* page.
- **Preview**: images and GIFs have zoom / pan / split / side by side / 100 % / fit, and GIFs can be paused. Clips have play, pause, a timeline, sound and a synced split or side-by-side compare.
- **Convert**: Clip → GIF, GIF → MP4, GIF → image sequence (PNG folder), images → GIF (each image shown for a set time). Options: FPS, width (never enlarged), quality, size limit.
- **Discord sizes** (Image / GIF): profile picture (512×512 square, 8 MB), profile banner (680×240 minimum, 10 MB), server banner (960×540, 16:9). Aoze enlarges with waifu2x only as much as needed, crops to the exact ratio, outputs PNG (GIFs stay GIF) and compresses if the file is over the cap. These are *recommended* sizes from Discord's help pages, not guarantees: Discord may still re-encode.
- **Result details**: resolution, pixels, size, format, frames and FPS before → after, plus what was done. No made-up “quality %”.
- **Finish**: the output folder opens when processing ends (Settings → *Open output folder when finished*, on by default).
- **Queue**: processing with real per-frame or per-second progress, time left, pause, cancel (the process is killed, no partial file), retry, history.
- **Startup**: logo, a soft light, then a quick local system check (graphics card, memory, processor; no benchmark) and *Ready*, in about two seconds. The welcome voice ("Welcome to Aoze… Made for aoxy, by zero.") plays as the app appears. Settings → Sounds turns it off; a `startup-sound.mp3`, `.ogg` or `.wav` in `%APPDATA%\app.aoze` replaces the voice. A missing or unplayable file never blocks the launch.
- **Completion sound**: one soft sound per run (never one per file), with its own switch and a volume slider.

### Clips: Smooth Motion, HDR, Look

The video engine and the measurements behind its choices (models, flicker, VRAM, pipeline order, licences) are in [docs/VIDEO_ENGINE.md](docs/VIDEO_ENGINE.md).

- **Clean-up**: anime goes through realesr-animevideov3 (Real-ESRGAN's video model), live action through waifu2x photo, then a temporal stabilisation (`atadenoise`) settles shimmering detail where nothing moves.
- **Scene cuts** are detected while decoding: Smooth Motion never blends two shots.
- **Motion blur** is a virtual shutter: RIFE renders sub-frames and Aoze averages the ones inside the shutter (Low ~120°, Medium ~180°, High ~240°).
- **Resume**: an interrupted clip keeps its finished segments; retrying continues from there (kept 3 days).
- **HDR → SDR** uses libplacebo on the GPU (BT.2390, per-scene peak detection) when Vulkan works, a LUT otherwise.

- **Smooth Motion** creates real in-between frames with [RIFE](https://github.com/hzwer/ECCV2022-RIFE) (rife-ncnn-vulkan, v4.6 model, optical flow on the GPU), so 24 FPS becomes a fluid 60 or 120 FPS. Levels are different processing, not labels: *Low* estimates motion at a lower resolution (fastest), *Medium* at full resolution, *High* adds a mirrored second pass averaged in (cleanest, about twice as slow). Rates above the source are only offered when Smooth Motion can make them (RIFE and a Vulkan GPU present, at most 8× the source). NTSC sources stay NTSC (23.976 → 59.94). Clips are processed in blocks with a few frames of look-ahead, so long clips never fill the memory and the cadence stays exact across blocks. Motion blur can be added on top (applied to the interpolated frames).
- **HDR**: *Off* always writes SDR (HDR sources are tone mapped properly), *Auto* keeps an HDR source in HDR (HEVC Main 10, PQ or HLG, BT.2020 tags and HDR10 metadata), *Enhanced* also rebuilds SDR clips as HDR10 by inverse tone mapping: mid tones stay at the BT.2408 reference white (203 nits), highlights expand smoothly up to 1000 nits. Clean-up and Smooth Motion work on 8-bit images, so an HDR source going through them is tone mapped first (the panel says so). HDR results get a tone-mapped preview copy for the comparison, which is also used for HDR files you import.
- **Look**: exposure, contrast, saturation (applied in linear light, in the same 3D LUT as the HDR conversion) and sharpness (CAS). At 0 nothing changes.
- **Edit** preset: sharper, real 60 FPS with Smooth Motion, 20 % motion blur, a touch of contrast and saturation.

### Honest by design

- **Retime** changes the frame rate by repeating or dropping frames, and says so. **Smooth motion** creates real in-between frames (FFmpeg `minterpolate`); it is slow on long clips.
- **GIF** frames are timed in 1/100 s, so 50 FPS is the highest exact rate; 60 is not offered for GIFs.
- The **output size shown before compressing an image** is a real encode of that image, so it is exact. With a limit, Aoze lowers quality first, then resolution, and the result says whether the limit was met.
- **Single-image progress** is estimated (the engine prints none) and marked “≈”. GIF and clip progress is measured (frames written, media time encoded).
- **Clean-up on clips** runs waifu2x on every frame: expect minutes for long clips. *Sharpen* is the fast option.
- waifu2x-ncnn-vulkan writes a **blank image and reports success** when the GPU device is lost. Aoze detects the Vulkan error, discards that output and retries once with smaller tiles.
- Metadata (EXIF, ICC) is not preserved.
- Clips that WebView2 cannot play (HEVC, 10-bit, MKV, AVI…) get a small H.264 **preview copy** for the viewer; processing always uses the original. Rotated phone videos are probed with their display orientation.

## Performance

Settings → Performance:

- **Mode**: *Balanced* (default) leaves room for the rest of the PC: the engine and FFmpeg run at below-normal priority. *Quality* is the same with slower video encoder presets (x264 `slow`, NVENC `p7`). *Performance* uses everything to finish sooner.
- **Auto optimize** (on by default) reads the hardware at launch and at the start of each run (free memory changes) and chooses:
  - waifu2x **tile size**: 100 px on modest GPUs (integrated or under 3 GB), 200 px on mid-range ones (under 6 GB), automatic above. Smaller tiles mean shorter GPU bursts, so Windows and Aoze's own interface keep getting GPU time;
  - **threads** (load:proc:save), lower on 4-thread CPUs or with little memory;
  - **clip block size** (frames held at once): 150 MB with little free memory, 400 MB normally, 800 MB in Performance mode on a powerful PC;
  - a **two-pass GIF palette** when all the frames of a GIF would not fit in that budget (one-pass `palettegen` keeps every frame in memory);
  - on modest GPUs, a light **preview copy** for clips above 1440p, and no background blur or scan line in the interface.

  When it is off, the tile and thread values from the Advanced settings are used. Tuning never changes the output pixels.
- After a GPU error, the engine retries once with smaller tiles.
- The interface does not depend on the GPU used for processing: the progress bar and the scan line only animate `transform`/`opacity` (compositor animations), the image filters were replaced by a plain dim layer, background blurs are dropped while a file is processed, and pan, zoom and wheel updates are merged per frame.
- For testing, `AOZE_SIMULATE_HARDWARE=low` (or `cpu`) makes Aoze behave as on a small laptop.

## Hardware

- **Any Vulkan GPU** (NVIDIA, AMD, Intel, integrated) for waifu2x. Without one, Aoze switches to the **CPU** automatically, which works but is much slower.
- **Video encoding**: at startup Aoze test-encodes with NVENC (NVIDIA), AMF (AMD) and Quick Sync (Intel) and uses the first one that works. Otherwise it falls back to x264 on the CPU. Size-limited clips always use x264 two-pass for accuracy.

## Architecture

```
React UI  (pages: Home · Image & GIF · Clip · Convert · History · Settings · Help)
   ↓ Zustand stores — services/api.ts (only place calling Tauri)
Rust commands
   ↓
core / queue        one GPU worker, events queue://*, real progress
   ├─ pipeline.rs   still images: engine → resize → encode (compress.rs: size-limit search)
   ├─ convert.rs    Clip→GIF, GIF→MP4, GIF→frames, images→GIF (FFmpeg)
   └─ anim.rs       GIF / clip: frames → waifu2x (folder mode, by blocks for clips) → FFmpeg filters → encode
engine/ (UpscaleEngine trait) → waifu2x-ncnn-vulkan.exe → Vulkan
media.rs (FFmpeg)  → ffprobe / ffmpeg (-progress), hardware encoder detection
```

Folder layout:

```
scripts/fetch-engine.mjs   downloads + SHA-256-verifies waifu2x-ncnn-vulkan, FFmpeg and rife-ncnn-vulkan (v4.6 model only) into src-tauri/resources
src/app/                   shell: titlebar, sidebar, splash, theme, global events
src/features/              home, workspace, convert, upscale (controls, stage, result), viewer (images/GIFs, clips),
                           queue, settings, history, help, diagnostics, about
src/components/ui/         Button, Segmented, Select, Slider, Toggle, Tooltip, HelpTip, Sheet, Page, Field…
src/utils/                 formatting, capability rules, presets (+ Vitest tests)
src-tauri/src/             core, queue, tuning, pipeline, anim, smooth (RIFE), color (HDR / Look LUT), convert, compress, media, imaging, output, engine/, gpu, settings, history, perf
src-tauri/tests/           engine_integration.rs, media_integration.rs (real engine + FFmpeg), gif_memory.rs
```

## Build

Requirements: Windows 10/11 x64, Node.js 20+, Rust (MSVC toolchain), Visual Studio Build Tools (C++).

```bash
npm install
```

```bash
npm run fetch-engine
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` produces `src-tauri/target/release/bundle/nsis/Aoze_<version>_x64-setup.exe` (per-user installer, no admin rights,
adds an optional “Open with Aoze” Explorer entry for images, GIFs and videos) and an MSI.

`npm test` runs Vitest, then `cargo test`: unit tests plus integration tests that use the real engine and FFmpeg. They cover:
- images: PNG, JPG, WebP and BMP, every scale, transparency, conflicts, invalid files, missing models, an invalid GPU, cancellation and a 6000×4000 image;
- compression: compress only, improve + compress, KB / MB limits;
- GIFs: resize, waifu2x per frame, retime to 50 FPS, frame count, timing, transparency and a size limit;
- clips: Sharpen, 30 FPS, motion blur with the audio kept, real 60 FPS interpolation, clean-up by blocks, a two-pass size limit, cancellation and invalid files.

## Data locations

Settings, history and measured speeds: `%APPDATA%\app.aoze` (migrated automatically from Kirei on first launch).
Cache and previews: `%LOCALAPPDATA%\app.aoze`. Logs: Diagnostics → *Open logs folder*.

## Troubleshooting

| Symptom | What to do |
|---|---|
| “No Vulkan GPU — using CPU” | Update the graphics driver, then Diagnostics → *Re-detect GPU*. |
| “The GPU stopped responding” / “ran out of memory” | Advanced → Tile size 64–128; close games or other GPU-heavy apps. |
| “Video tools are missing” | An antivirus may have quarantined `ffmpeg.exe`; restore it or reinstall. |
| A clip does not preview | Aoze makes an H.264 preview copy for formats WebView2 cannot play; wait a moment after adding it. |
| Anything else | Diagnostics → **Copy diagnostic**. |

## Credits and licences

Aoze's own code is released under the [MIT License](LICENSE). The bundled third-party programs and models keep their own licences, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Aoze is built on the work of others, whose licences ship with the app:

- **waifu2x** by nagadomi: the enlargement / noise reduction method and models.
- **[waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan)** by nihui (MIT License, `engine/LICENSE`): the GPU engine.
- **[FFmpeg](https://ffmpeg.org)** (GPL build by [BtbN](https://github.com/BtbN/FFmpeg-Builds), `ffmpeg/LICENSE.txt`): GIF and video processing.
- **[RIFE](https://github.com/hzwer/Practical-RIFE)** by hzwer (MIT, v4.6 and v4.25 weights) run by **[rife-ncnn-vulkan](https://github.com/TNTwise/rife-ncnn-vulkan)** (TNTwise's maintained fork of nihui's, MIT, `rife/LICENSE`): Smooth Motion and motion blur.
- **[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)** by xinntao (BSD-3-Clause, realesr-animevideov3 weights) and realesrgan-ncnn-vulkan (MIT), `realesrgan/LICENSE.txt`: anime clip clean-up.
- Welcome voice made with [Piper](https://github.com/rhasspy/piper) (en_US *hfc_female* voice, trained on the Hi-Fi TTS dataset, CC BY 4.0), mixed with FFmpeg.
- Tauri 2, React 19, TypeScript, Zustand, Radix UI, Motion, Lucide.
