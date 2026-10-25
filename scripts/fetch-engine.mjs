// Downloads the third-party binaries bundled with Aoze, verifies their SHA-256
// and extracts them into src-tauri/resources so they ship with the installer:
//   - waifu2x-ncnn-vulkan (nihui, MIT): image enlargement / denoising
//   - FFmpeg (BtbN GPL shared build): GIF and clip decoding, filters, encoding
//   - rife-ncnn-vulkan (TNTwise fork of nihui's, MIT): RIFE frame interpolation (Smooth Motion)
//   - realesrgan-ncnn-vulkan (xinntao, MIT; weights BSD-3): anime video clean-up
//
//   node scripts/fetch-engine.mjs              always (re)install
//   node scripts/fetch-engine.mjs --if-missing skip what is already present
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = join(root, "src-tauri", "resources");

const ARTIFACTS = [
  {
    name: "waifu2x-ncnn-vulkan",
    version: "20220728",
    url: "https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/20220728/waifu2x-ncnn-vulkan-20220728-windows.zip",
    sha256: "3f60ba0b26763c602cb75178c2051bf0c46f3cc9d13975a052a902773988a34b",
    dir: join(resources, "engine"),
    marker: "ENGINE_VERSION",
    probe: "waifu2x-ncnn-vulkan.exe",
    // Strip the top-level folder, keep everything.
    map: (rel) => rel,
  },
  {
    name: "ffmpeg",
    version: "n8.1.3-24-g92611900bb",
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-24-13-02/ffmpeg-n8.1.3-24-g92611900bb-win64-gpl-shared-8.1.zip",
    sha256: "d51f8d562fe3dddd0b65f98871c715a2f5471d3589f004ed2c018f18b6b23e3f",
    dir: join(resources, "ffmpeg"),
    marker: "FFMPEG_VERSION",
    probe: "ffmpeg.exe",
    // Only the runtime: ffmpeg/ffprobe + their DLLs and the license. No ffplay, headers or import libs.
    map: (rel) => {
      if (rel === "LICENSE.txt") return "LICENSE.txt";
      const m = /^bin\/([^/]+\.(exe|dll))$/.exec(rel);
      if (!m || m[1] === "ffplay.exe") return null;
      return m[1];
    },
  },
  {
    name: "rife-ncnn-vulkan-tntwise",
    version: "20250112",
    url: "https://github.com/TNTwise/rife-ncnn-vulkan/releases/download/20250112/windows.zip",
    sha256: "42ed35e115b026f222386648920218cb8a9c7ae1e23698a7363bdd2e1455aba3",
    dir: join(resources, "rife"),
    marker: "RIFE_VERSION",
    probe: "rife-ncnn-vulkan.exe",
    // Maintained MIT fork of nihui's build (new-model padding fix). The archive
    // holds every RIFE model (830 MB): keep the runtime, v4.6 (default, light on
    // VRAM) and v4.25 (Quality on anime). See docs/VIDEO_ENGINE.md.
    strip: 3,
    map: (rel) => {
      if (["rife-ncnn-vulkan.exe", "vcomp140.dll", "LICENSE"].includes(rel)) return rel;
      return /^rife-v4\.(6|25)\/[^/]+$/.test(rel) ? rel : null;
    },
  },
  {
    name: "realesrgan-ncnn-vulkan",
    version: "20220424",
    url: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip",
    sha256: "abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d",
    dir: join(resources, "realesrgan"),
    marker: "REALESRGAN_VERSION",
    probe: "realesrgan-ncnn-vulkan.exe",
    // Only the anime video model (x2/x3/x4, 1.2 MB each): the RRDB models are
    // too slow for video on most GPUs (docs/VIDEO_ENGINE.md).
    strip: 0,
    license: "realesrgan-LICENSE.txt",
    map: (rel) => {
      if (["realesrgan-ncnn-vulkan.exe", "vcomp140.dll"].includes(rel)) return rel;
      return /^models\/realesr-animevideov3-x[234]\.(param|bin)$/.test(rel) ? rel : null;
    },
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function isInstalled(a) {
  const marker = join(a.dir, a.marker);
  if (!existsSync(join(a.dir, a.probe)) || !existsSync(marker)) return false;
  return (await readFile(marker, "utf8")).trim() === a.version;
}

async function download(a) {
  const cacheZip = join(root, "node_modules", ".cache", `${a.name}-${a.version}.zip`);
  if (existsSync(cacheZip)) {
    const cached = await readFile(cacheZip);
    if (sha256(cached) === a.sha256) return cached;
  }
  console.log(`[${a.name}] downloading ${a.url}`);
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`${a.name}: download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const chunks = [];
  let received = 0;
  let lastPct = -10;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct >= lastPct + 10) {
      lastPct = pct;
      console.log(`[${a.name}] ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
    }
  }
  const buf = Buffer.concat(chunks);
  const hash = sha256(buf);
  if (hash !== a.sha256) throw new Error(`${a.name}: checksum mismatch: expected ${a.sha256}, got ${hash}`);
  await mkdir(dirname(cacheZip), { recursive: true });
  await writeFile(cacheZip, buf);
  return buf;
}

function extract(buf, dest, map, strip = 1) {
  return new Promise((resolvePromise, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("end", resolvePromise);
      zip.on("entry", (entry) => {
        const rel = entry.fileName.split("/").slice(strip).join("/");
        const target = rel && !rel.endsWith("/") ? map(rel) : null;
        if (!target) return zip.readEntry();
        const out = resolve(dest, target);
        if (!out.startsWith(dest)) return reject(new Error(`unsafe zip entry: ${entry.fileName}`));
        zip.openReadStream(entry, async (e, stream) => {
          if (e) return reject(e);
          await mkdir(dirname(out), { recursive: true });
          stream.pipe(createWriteStream(out)).on("finish", () => zip.readEntry()).on("error", reject);
        });
      });
      zip.readEntry();
    });
  });
}

async function install(a) {
  if (process.argv.includes("--if-missing") && (await isInstalled(a))) return;
  const buf = await download(a);
  await rm(a.dir, { recursive: true, force: true });
  await mkdir(a.dir, { recursive: true });
  await extract(buf, a.dir, a.map, a.strip ?? 1);
  if (a.license) await writeFile(join(a.dir, "LICENSE.txt"), await readFile(join(root, "scripts", "licenses", a.license)));
  await writeFile(join(a.dir, a.marker), a.version);
  console.log(`[${a.name}] ${a.version} installed in ${a.dir}`);
}

async function main() {
  for (const a of ARTIFACTS) await install(a);
}

main().catch((e) => {
  console.error(`[fetch] ${e.message}`);
  process.exit(1);
});
