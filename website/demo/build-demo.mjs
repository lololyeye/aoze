// Builds the before/after media shown on the website, with the engines Aoze ships.
// Nothing here is mocked: "Enhanced" files are the real output of waifu2x and RIFE.
//
//   node demo/build-demo.mjs [path to an Aoze install or src-tauri/resources]
//
// Output goes to public/demo/. Re-run it after changing scene.svg.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [process.argv[2], join(here, "../../Aoze"), join(here, "../../src-tauri/resources")].filter(Boolean);
const aoze = candidates.map((p) => resolve(p)).find((p) => existsSync(join(p, "ffmpeg/ffmpeg.exe")));
if (!aoze) throw new Error("Aoze engines not found. Pass the install folder, or run `npm run fetch-engine` at the repo root.");

const ffmpeg = join(aoze, "ffmpeg/ffmpeg.exe");
const waifu2x = join(aoze, "engine/waifu2x-ncnn-vulkan.exe");
const rife = join(aoze, "rife/rife-ncnn-vulkan.exe");
const out = join(here, "../public/demo");
const tmp = mkdtempSync(join(tmpdir(), "aoze-demo-"));
mkdirSync(out, { recursive: true });

const run = (bin, args) => execFileSync(bin, args, { stdio: ["ignore", "ignore", "inherit"] });
const ff = (...args) => run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const svg = join(here, "scene.svg");

// Image: a small, heavily compressed JPEG (the kind of file people want to fix),
// then Aoze's default enlarge: waifu2x cunet, 4x, noise reduction level 2.
ff("-i", svg, "-vf", "scale=400:250:flags=area", "-q:v", "20", join(out, "image-original.jpg"));
run(waifu2x, ["-i", join(out, "image-original.jpg"), "-o", join(tmp, "enhanced.png"), "-s", "4", "-n", "2", "-m", join(aoze, "engine/models-cunet")]);
ff("-i", join(tmp, "enhanced.png"), "-c:v", "libwebp", "-quality", "86", join(out, "image-enhanced.webp"));

// Clip: a 24 FPS camera move, then Smooth Motion (RIFE v4.6) to 60 FPS.
const seconds = 6;
const src = join(tmp, "src");
const smooth = join(tmp, "smooth");
mkdirSync(src);
mkdirSync(smooth);
ff("-i", svg, "-vf", "scale=1920:1200", join(tmp, "big.png"));
ff("-loop", "1", "-framerate", "24", "-i", join(tmp, "big.png"), "-t", String(seconds),
  "-vf", `crop=960:540:x='480*(1-cos(2*PI*t/${seconds}))':y=360`, "-pix_fmt", "rgb24", join(src, "%08d.png"));
const frames = readdirSync(src).length;
run(rife, ["-i", src, "-o", smooth, "-m", join(aoze, "rife/rife-v4.6"), "-n", String(Math.round((frames * 60) / 24))]);

// One side-by-side file keeps both halves in sync on every browser.
const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", "-an"];
ff("-framerate", "24", "-i", join(src, "%08d.png"), "-framerate", "60", "-i", join(smooth, "%08d.png"),
  "-filter_complex", "[0]fps=60,scale=640:360[a];[1]scale=640:360[b];[a][b]hstack=2", ...h264, join(out, "motion-24-60.mp4"));
ff("-framerate", "24", "-i", join(src, "%08d.png"), "-framerate", "60", "-i", join(smooth, "%08d.png"),
  "-filter_complex", "[0]fps=60,scale=640:360[a];[1]scale=640:360[b];[a][b]vstack=2", ...h264, join(out, "motion-24-60-v.mp4"));
ff("-i", join(out, "motion-24-60.mp4"), "-frames:v", "1", "-q:v", "4", join(out, "motion-poster.jpg"));
ff("-i", join(out, "motion-24-60-v.mp4"), "-frames:v", "1", "-q:v", "4", join(out, "motion-poster-v.jpg"));

rmSync(tmp, { recursive: true, force: true });
console.log(`Demo media written to ${out} (${frames} source frames).`);
