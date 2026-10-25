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
