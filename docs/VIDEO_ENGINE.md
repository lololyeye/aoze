# Aoze — video engine study (Clip)

Measured on the reference machine: GTX 1650 (4 GB, Vulkan), 16 GB RAM, 12 threads.
Test material: the One Piece extract shipped with Real-ESRGAN (real anime, 640×480,
on twos, with a scene cut) and a 10 s live-action 1080p clip (samplelib, 29.97 FPS).
Scripts: `scratchpad/bench/bench_rife.py`, `bench_up.py`, `bench_stab.py` (not shipped).

## 1. Engine before this study

`anim.rs::run_clip`: frames (JPEG) → waifu2x per block (Clean-up) → RIFE v4.6 per block
(Smooth Motion, exact cadence, 8× max) → H.264 segments → concat → final pass
(resize, CAS, FFmpeg `tmix` motion blur, colour LUT / HDR) → NVENC / x264 / x265.

Weak points found:

| Problem | Effect |
|---|---|
| No scene-cut detection | RIFE morphs one shot into the next (measured: frame 97→101 of the anime test turns two characters into one face). The biggest visual defect. |
| Motion blur = `tmix` of neighbouring frames | Ghost copies instead of a smear along the motion, especially at 24–30 FPS. |
| Clean-up = waifu2x per frame | Close to a Lanczos resize on real anime; no temporal stabilisation. |
| HDR → SDR = static LUT | No per-scene peak detection. |
| A cancelled / crashed clip restarts from zero | Long clips waste time. |

## 2. Frame interpolation

| Project | Role | Licence | Notes |
|---|---|---|---|
| hzwer/ECCV2022-RIFE, Practical-RIFE | the model | MIT (code and weights) | author recommends 4.25 by default, 4.25-lite for limited compute |
| nihui/rife-ncnn-vulkan | runtime (Vulkan: NVIDIA, AMD, Intel, CPU) | MIT | last release 2022, models ≤ 4.6 |
| TNTwise/rife-ncnn-vulkan | maintained fork | MIT | models up to 4.26, padding fix for new models (2025) |
| Flowframes / OpenFlowFrames | GUI over rife-ncnn | GPL-3.0 | reference only, nothing copied |
| LocallyFPS | GUI over rife-ncnn (v4.6) | MIT | frame validation, checkpoints, HDR→SDR |
| PixelFlow | CLI, Real-ESRGAN + RIFE over ncnn | MIT | upscale then interpolate |

Every serious open-source tool that runs on all GPUs uses **rife-ncnn-vulkan**; CUDA /
TensorRT builds are faster on NVIDIA but exclude AMD / Intel. Kept: ncnn-Vulkan.

**Measured** (one frame in two, or three in four, rebuilt and compared with the real frame;
only pairs with real motion):

| Model | live 540p ×2 PSNR | live 540p ×4 PSNR | speed 540p | VRAM 540p | VRAM 1080p |
|---|---|---|---|---|---|
| v4.6 | 27.54 | 25.07 | 22–29 fps | 190–300 MB | **482 MB** |
| v4.22-lite | 26.86 | 24.60 | 21–29 fps | 517 MB | — |
| v4.25-lite | 27.05 | 24.43 | 22–27 fps | 676 MB | 2019 MB |
| v4.25 | 27.52 | 24.87 | 22–26 fps | 546 MB | 1793 MB |
| v4.26 | 27.42 | 24.86 | 23–27 fps | 578 MB | — |

Speed is the same for all (frame I/O bound). On these clips the newer models are **not
measurably better** but need **3–4× the VRAM** (1.8–2 GB at 1080p, too much for 2 GB
cards). On anime, PSNR against the original is not meaningful (drawings are held for
2–3 frames, RIFE invents the motion), and a visual check shows the same result for 4.6
and 4.25. The real defect is the missing scene detection (both models morph across cuts).

Decision: **v4.6 by default** (all GPUs); **v4.25** only in *Quality* on anime with ≥ 4 GB
VRAM and output ≤ 1080p (the author's recommendation for anime). Runtime: TNTwise build
(MIT, maintained, supports both).

## 3. Upscaling (Clean-up)

Real-ESRGAN (xinntao): code BSD-3-Clause, `realesrgan-ncnn-vulkan` MIT, weights BSD-3.

| Model (2×, 48 frames) | anime fps | live fps | VRAM | flicker anime | flicker live |
|---|---|---|---|---|---|
| Lanczos (reference) | — | — | — | 0.081 | 0.664 |
| waifu2x cunet | 3.9 | 2.4 | 540 MB | 0.145 | 0.564 |
| waifu2x upconv7 anime | 10.2 | 6.0 | 330 MB | 0.128 | 0.667 |
| waifu2x upconv7 photo | 10.1 | 5.9 | 338 MB | 0.144 | 0.703 |
| **realesr-animevideov3** | 5.4 | 3.8 | **177 MB** | 0.200 | 0.900 |
| realesrgan-x4plus-anime | 0.7 | 0.5 | 2.07 GB | 0.177 | 1.048 |
| realesrgan-x4plus | 0.2 | 0.1 | 2.56 GB | 0.274 | 1.069 |

(flicker = mean frame-to-frame change in areas that do not move in the source, at source
resolution; lower is steadier.)

- **Anime**: realesr-animevideov3 is clearly the best visually (clean, sharp line art,
  compression mush removed; waifu2x stays close to Lanczos), the lightest in VRAM, fast
  enough. Its extra flicker is fixed by temporal stabilisation (section 4).
- **Live action**: the RRDB models (x4plus) are unusable for video on this class of GPU
  (0.1–0.5 fps, 2+ GB). The compact `realesr-general-x4v3` exists only as a PyTorch file.
  waifu2x photo stays the live-action model: fast, low VRAM, steadiest.
- Never the heaviest model by default.

## 4. Temporal consistency

Measured on animevideov3 output:

| Method | flicker anime | flicker live | sharpness |
|---|---|---|---|
| none | 0.200 | 0.900 | 100 % |
| temporal denoise before (hqdn3d) | 0.213 | 0.827 | — |
| **adaptive temporal average after (atadenoise)** | **0.125** | **0.744** | 99.6 % |
| both | 0.124 | 0.708 | — |

`atadenoise` only averages pixels whose change stays under a threshold, so moving edges
are untouched (checked on the frame with the most motion: no ghosting) while shimmering
detail settles. Applied to the continuous stream (not per block), window scaled to the
output rate. Recurrent video models (BasicVSR, AnimeSR, SeedVR) are steadier still but
need PyTorch / CUDA and far more VRAM: out of scope for a portable app.

## 5. HDR

libplacebo (LGPL-2.1, already inside the bundled FFmpeg build) works through Vulkan on the
test GPU (2 s of 720p HDR → SDR in 1.8 s). It brings dynamic per-scene peak detection,
BT.2390 tone mapping, perceptual gamut mapping and contrast recovery.

- HDR → SDR: libplacebo when Vulkan works, the existing LUT otherwise.
- SDR → HDR (*Enhanced*): kept on Aoze's documented inverse tone mapping (mid tones at the
  BT.2408 reference white, highlights to 1000 nits): deterministic and tested.
- HDR kept: HEVC Main 10, PQ / HLG tags, HDR10 metadata.

## 6. Motion blur

Real motion blur is the exposure of a moving image: Aoze now asks RIFE for extra
sub-frames between output frames and averages the ones inside the virtual shutter
(Low ≈ 120°, Medium ≈ 180°, High ≈ 270°), then keeps one frame per output frame. The
smear follows the motion; nothing moves, nothing blurs. Without RIFE, the former frame
mix remains as a fallback.

## 7. Final pipeline

```
Input
 → decode (+ HDR → SDR with libplacebo when frames must be processed in 8 bit)
   + scene-cut detection (same decode pass)
 → per block (bounded memory, resumable):
     Clean-up: realesr-animevideov3 (anime) / waifu2x photo (live action)
     Smooth Motion: RIFE (v4.6, or v4.25 in Quality on anime), never across a cut
       + sub-frames for motion blur, blended and decimated
     → lossless-ish segment (H.264 CRF 12 / NVENC QP 14)
 → concat
 → temporal stabilisation (after Clean-up) → light sharpening (CAS)
 → colour: Look + HDR (libplacebo / LUT) → encode (NVENC / AMF / QSV / x264 / x265)
 → output with the original audio
```

Order rationale: upscale before interpolation (RIFE works on clean frames and in-between
frames are never upscaled, so their artefacts are not amplified); stabilisation after both
(continuous stream); colour last (one conversion, at full precision); sharpening after
the upscale and before colour.

## 8. Adaptation to the hardware (Auto)

- RIFE model: v4.6 unless *Quality* + anime + VRAM ≥ 4 GB + output ≤ 1080p.
- Tiles, threads, block size: `tuning.rs` (GPU tier, VRAM, free RAM).
- Motion blur sub-frames cost RIFE time; the time estimate includes them.
- CPU fallback: ncnn runs on the CPU when no Vulkan device works (slow, said in the UI).

## 9. Licences of what ships

| Component | Licence | Ships |
|---|---|---|
| rife-ncnn-vulkan (TNTwise fork of nihui) | MIT | exe, vcomp140.dll, LICENSE |
| RIFE v4.6 / v4.25 weights (hzwer) | MIT | ncnn models |
| realesrgan-ncnn-vulkan (xinntao) | MIT | exe, vcomp140.dll |
| realesr-animevideov3 weights (xinntao) | BSD-3-Clause | ncnn models |
| waifu2x-ncnn-vulkan (nihui) | MIT | unchanged |
| FFmpeg (BtbN GPL build, with libplacebo LGPL-2.1) | GPL-3.0 | unchanged |

Nothing is copied from GPL projects (Flowframes / OpenFlowFrames); they were read as
references only.
