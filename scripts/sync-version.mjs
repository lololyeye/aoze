// Copies the version of package.json (the one source of truth) to the places that cannot
// read it themselves, and starts the release notes of that version.
//
//   npm version 1.2.0        runs this script through the "version" lifecycle hook
//
// - tauri.conf.json reads package.json directly ("version": "../package.json");
// - Cargo.toml and Cargo.lock get the same version here (env!("CARGO_PKG_VERSION") in the app);
// - docs/release-notes/<version>.json is created empty if missing, to be filled in before
//   `npm run release`, which refuses empty notes;
// - the website reads the published GitHub release, never this repository.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`unexpected version "${version}" (expected x.y.z)`);

const cargoToml = join(root, "src-tauri", "Cargo.toml");
const toml = await readFile(cargoToml, "utf8");
await writeFile(cargoToml, toml.replace(/^version = "[^"]+"/m, `version = "${version}"`));

// The lock file records the crate's own version too; cargo would rewrite it on the next build.
const cargoLock = join(root, "src-tauri", "Cargo.lock");
const lock = await readFile(cargoLock, "utf8");
await writeFile(cargoLock, lock.replace(/(\[\[package\]\]\r?\nname = "aoze"\r?\nversion = )"[^"]+"/, `$1"${version}"`));

const notes = join(root, "docs", "release-notes", `v${version}.json`);
if (!existsSync(notes)) {
  const empty = { improvements: [], changes: [], fixes: [] };
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(notes, JSON.stringify({ version, date: today, en: empty, fr: empty }, null, 2) + "\n");
  console.log(`[version] created ${notes}: fill it in before releasing`);
}
console.log(`[version] Aoze ${version}`);
