// Builds a public release of Aoze and gathers it in release/v<version>/.
//
//   npm run release
//
// 1. Checks the version (package.json, copied to Cargo.toml by `npm version`) and its release
//    notes (docs/release-notes/v<version>.json).
// 2. Fetches the bundled engines (pinned versions, SHA-256 checked by fetch-engine.mjs).
// 3. Builds the installer with local paths (user name, checkout folder, cargo cache)
//    remapped out of the Rust binary, then checks no such path is left. The installer is
//    signed with the updater key (TAURI_SIGNING_PRIVATE_KEY, or ~/.tauri/aoze-updater.key).
// 4. Writes the release folder: installer, latest.json (update manifest read by the app),
//    RELEASE_NOTES.md, SHA256SUMS.txt, LICENSE, THIRD_PARTY_NOTICES.md and
//    THIRD_PARTY_LICENSES.txt (full licence texts of every Rust crate and npm package
//    compiled into the app).
// Code signing (Authenticode) is not part of this script: see RELEASE.md.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(root, "src-tauri");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const read = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });

// 1. Version and release notes
const REPO = "lololyeye/aoze";
const pkgVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const confVersion = JSON.parse(await readFile(join(tauri, "tauri.conf.json"), "utf8")).version;
const cargoVersion = (await readFile(join(tauri, "Cargo.toml"), "utf8")).match(/^version = "([^"]+)"/m)[1];
if (confVersion !== "../package.json") throw new Error(`tauri.conf.json must read its version from package.json, not "${confVersion}"`);
if (pkgVersion !== cargoVersion) {
  throw new Error(`version mismatch: package.json ${pkgVersion}, Cargo.toml ${cargoVersion}. Run: npm version ${pkgVersion} --allow-same-version`);
}
const version = pkgVersion;
const notesFile = join(root, "docs", "release-notes", `v${version}.json`);
if (!existsSync(notesFile)) throw new Error(`missing release notes: ${notesFile}`);
const notes = JSON.parse(await readFile(notesFile, "utf8"));
const items = (body) => (body?.changes?.length ?? 0) + (body?.improvements?.length ?? 0) + (body?.fixes?.length ?? 0);
if (notes.version !== version || !items(notes.en)) throw new Error(`${notesFile}: version must be ${version} and the English notes must list at least one change`);
console.log(`[release] Aoze ${version}`);

// The updater key signs the installer; the app only installs updates signed with it.
const keyFile = join(homedir(), ".tauri", "aoze-updater.key");
const signingEnv = {};
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!existsSync(keyFile)) throw new Error(`no updater key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyFile} (see RELEASE.md)`);
  signingEnv.TAURI_SIGNING_PRIVATE_KEY = await readFile(keyFile, "utf8");
  signingEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
}

// 2. Engines
run("node", ["scripts/fetch-engine.mjs"]);

// 3. Build, without local paths in the binary
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
const remaps = [
  [homedir(), "~"],
  [cargoHome, "cargo"],
  [root, "aoze"],
];
// The encoded form takes flags separated by 0x1f, so paths may contain spaces.
const rustflags = remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join("\x1f");
// npx is a .cmd script on Windows, so it needs a shell; no argument contains spaces.
run("npx", ["tauri", "build", "--bundles", "nsis", "--config", "src-tauri/tauri.updater.conf.json"], {
  shell: process.platform === "win32",
  env: { ...process.env, ...signingEnv, RUSTFLAGS: "", CARGO_ENCODED_RUSTFLAGS: rustflags },
});

const exeName = `Aoze_${version}_x64-setup.exe`;
const setup = join(tauri, "target", "release", "bundle", "nsis", exeName);
const appExe = join(tauri, "target", "release", "aoze.exe");
const binary = await readFile(appExe);
const leaks = [homedir(), root].filter((p) =>
  [Buffer.from(p, "utf8"), Buffer.from(p, "utf16le")].some((needle) => binary.includes(needle)),
);
if (leaks.length) throw new Error(`aoze.exe still contains local paths: ${leaks.join(", ")}`);

// 4. Release folder
const out = join(root, "release", `v${version}`);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyFile(setup, join(out, exeName));
await copyFile(join(root, "LICENSE"), join(out, "LICENSE.txt"));
await copyFile(join(root, "THIRD_PARTY_NOTICES.md"), join(out, "THIRD_PARTY_NOTICES.md"));
await writeFile(join(out, "THIRD_PARTY_LICENSES.txt"), await thirdPartyLicenses());

const installer = await readFile(join(out, exeName));
const installerSha = createHash("sha256").update(installer).digest("hex");
const url = `https://github.com/${REPO}/releases/download/v${version}/${exeName}`;
// Update manifest, published as a release asset: the app reads it from
// https://github.com/<repo>/releases/latest/download/latest.json
const manifest = {
  version,
  notes: plainNotes(notes.en),
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: (await readFile(`${setup}.sig`, "utf8")).trim(),
      url,
      sha256: installerSha,
      size: installer.length,
    },
  },
  releaseNotes: notes,
};
await writeFile(join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(out, "RELEASE_NOTES.md"), releaseMarkdown(notes.en, installerSha));

const sums = [];
for (const name of (await readdir(out)).sort()) {
  const hash = createHash("sha256").update(await readFile(join(out, name))).digest("hex");
  sums.push(`${hash}  ${name}`);
}
await writeFile(join(out, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`[release] ${out}`);
console.log(sums.join("\n"));

function plainNotes(body) {
  return [...body.changes, ...body.improvements, ...body.fixes].map((l) => `- ${l}`).join("\n");
}

// The GitHub release notes, from the same JSON as the app's "What's new".
function releaseMarkdown(body, sha) {
  const list = (title, lines) => (lines.length ? [`### ${title}`, "", ...lines.map((l) => `- ${l}`), ""] : []);
  return [
    `**Aoze ${version}**${body.summary ? `: ${body.summary}` : ""}`,
    "",
    ...list("New", body.changes),
    ...list("Improved", body.improvements),
    ...list("Fixed", body.fixes),
    `Download **${exeName}**, run it, done (FFmpeg and every engine are included).`,
    "Aoze 1.1.0 and later update themselves: they offer the new version when it is out.",
    "The installer is per-user (no admin rights). It is not code-signed yet, so Windows SmartScreen",
    'may show "Windows protected your PC": choose "More info", then "Run anyway".',
    "",
    `SHA-256 of **${exeName}**: \`${sha}\``,
    "(all files: `SHA256SUMS.txt`). Third-party licences: `THIRD_PARTY_NOTICES.md` and",
    "`THIRD_PARTY_LICENSES.txt`.",
    "",
    "Made for aoxy, by zero.",
    "",
  ].join("\n");
}

// Full licence texts of everything compiled into aoze.exe and its frontend.
async function thirdPartyLicenses() {
  const parts = [
    `Third-party licences for Aoze ${version}`,
    "",
    "The bundled programs (waifu2x-ncnn-vulkan, FFmpeg, rife-ncnn-vulkan, realesrgan-ncnn-vulkan)",
    "and their models are listed in THIRD_PARTY_NOTICES.md; their licence files are installed",
    "next to them. Below are the libraries compiled into aoze.exe (Rust) and its interface (npm).",
    "",
  ];
  // `vendor/` holds the C sources some -sys crates compile in (libwebp-sys: libwebp).
  const licenceFiles = async (dir) => {
    const found = [];
    for (const sub of ["", "vendor"]) {
      for (const f of (await readdir(join(dir, sub)).catch(() => [])).sort()) {
        if (/^(licen[cs]e|copying|notice|patents)/i.test(f)) found.push(sub ? `${sub}/${f}` : f);
      }
    }
    return found;
  };

  const meta = JSON.parse(
    read("cargo", ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", "--locked"], tauri),
  );
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const todo = [meta.resolve.root];
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id).deps) if (d.dep_kinds.some((k) => k.kind === null)) todo.push(d.pkg);
  }
  seen.delete(meta.resolve.root);
  const crates = [...seen].map((id) => packages.get(id)).sort((a, b) => a.name.localeCompare(b.name));

  const npmLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const npm = Object.entries(npmLock.packages)
    .filter(([path, p]) => path && !p.dev && !p.devOptional)
    .map(([path, p]) => ({ name: path.split("node_modules/").pop(), version: p.version, license: p.license, dir: join(root, path) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const entries = [
    ...crates.map((c) => ({ kind: "crate", name: c.name, version: c.version, license: c.license ?? c.license_file, dir: dirname(c.manifest_path), url: c.repository })),
    ...npm.map((p) => ({ kind: "npm", ...p, url: null })),
  ];
  for (const e of entries) {
    parts.push("=".repeat(78), `${e.name} ${e.version} (${e.kind})`, `License: ${e.license ?? "see below"}`);
    if (e.url) parts.push(`Source: ${e.url}`);
    parts.push("");
    const files = await licenceFiles(e.dir);
    if (!files.length) parts.push(`(no licence file in the package; licensed under ${e.license})`, "");
    for (const f of files) parts.push(`--- ${f}`, (await readFile(join(e.dir, f), "utf8")).trim(), "");
  }
  return parts.join("\n");
}
