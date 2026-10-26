# Third-party software

Aoze's own code is under the MIT License (see `LICENSE`). The installer also ships
the programs and model weights below, each under its own licence. They are not
stored in this repository: `scripts/fetch-engine.mjs` downloads them from their
official releases and checks their SHA-256 before bundling.

| Component | Author | Licence | Used for |
|---|---|---|---|
| [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) and waifu2x models | nihui, nagadomi | MIT | image enlargement and noise reduction |
| [FFmpeg](https://ffmpeg.org) ([BtbN GPL build](https://github.com/BtbN/FFmpeg-Builds), with libplacebo LGPL-2.1) | FFmpeg developers | GPL-3.0 | GIF and video decoding, filters, encoding, HDR tone mapping |
| [rife-ncnn-vulkan](https://github.com/TNTwise/rife-ncnn-vulkan) (fork of [nihui/rife-ncnn-vulkan](https://github.com/nihui/rife-ncnn-vulkan)) | TNTwise, nihui | MIT | Smooth Motion runtime |
| [RIFE](https://github.com/hzwer/Practical-RIFE) v4.6 / v4.25 weights | hzwer | MIT | frame interpolation |
| [realesrgan-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) | xinntao | MIT | anime clip clean-up runtime |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) realesr-animevideov3 weights | xinntao | BSD-3-Clause | anime clip clean-up |
| Welcome voice: [Piper](https://github.com/rhasspy/piper), en_US *hfc_female* voice | rhasspy; Hi-Fi TTS data (NVIDIA) | CC BY 4.0 (voice) | startup voice (`public/sounds/welcome.ogg`) |
| Tauri, React, Zustand, Radix UI, Motion, Lucide, Inter | their authors | MIT / ISC / OFL-1.1 | application framework and UI |

Each bundled component's licence file is installed next to it (`engine/LICENSE`,
`ffmpeg/LICENSE.txt`, `rife/LICENSE`, `realesrgan/LICENSE.txt`).

The Microsoft OpenMP runtime `vcomp140.dll` shipped with the ncnn programs comes from
their official release archives (Visual C++ redistributable).

## Source code of the GPL components

FFmpeg is distributed under the GNU GPL version 3. Aoze runs `ffmpeg.exe` and `ffprobe.exe`
as separate programs and does not link to them. The exact build bundled in this release is:

- FFmpeg `n8.1.3-24-g92611900bb`, built by BtbN (`win64-gpl-shared-8.1`), release
  [`autobuild-2026-10-24-13-02`](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-24-13-02)
  (archive SHA-256 `d51f8d562fe3dddd0b65f98871c715a2f5471d3589f004ed2c018f18b6b23e3f`).
- FFmpeg source at that commit: <https://github.com/FFmpeg/FFmpeg/commit/92611900bb>
- Build scripts and the versions of every library compiled in: <https://github.com/BtbN/FFmpeg-Builds>

If any of these links stops working, open an issue on <https://github.com/lololyeye/aoze>
and the corresponding source code will be provided.

## Libraries compiled into Aoze

`THIRD_PARTY_LICENSES.txt`, published with each release, holds the full licence text of
every Rust crate and npm package compiled into `aoze.exe` and its interface. They are all
under permissive licences (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, BSL-1.0, OFL-1.1 for the
Inter font), except five MPL-2.0 crates used by Tauri (`cssparser`, `cssparser-macros`,
`dtoa-short`, `option-ext`, `selectors`), whose source is available unmodified on crates.io.
`aoze.exe` also contains Google's [libwebp](https://chromium.googlesource.com/webm/libwebp)
(BSD-3-Clause, compiled in through the `libwebp-sys` crate) for WebP output.
