# Releasing Aoze

How a public release is made, from the source code to the installer people download.

```
source code (this repository, a tagged commit)
  -> npm ci                      exact npm dependencies from package-lock.json
  -> npm run release             engines fetched + checked, app built, installer built
  -> release/v<version>/         installer, latest.json, SHA256SUMS.txt, licences, release notes
  -> GitHub Release v<version>   the files above; the website links to the installer,
                                 installed copies of Aoze read latest.json and update themselves
  -> installer -> Aoze installed in %LOCALAPPDATA%\Aoze (per user, no admin rights)
```

## Requirements

- Windows 10/11 x64.
- Node.js 22+ and npm.
- Rust (stable, MSVC toolchain) and the Visual Studio C++ build tools.
- Internet access for the first build (npm, crates.io, the engine downloads, the NSIS
  toolchain that Tauri fetches itself).

## Steps

1. **Version.** `package.json` is the only source of the version:

   ```
   npm version 1.2.0 --no-git-tag-version
   ```

   `tauri.conf.json` reads it directly; the `version` hook (`scripts/sync-version.mjs`) copies it
   to `Cargo.toml` / `Cargo.lock` and creates `docs/release-notes/v1.2.0.json`. The app, the
   installer, the update manifest and the GitHub release all take it from there; the website
   reads the published GitHub release. The release script refuses to run if anything differs.
2. **Release notes.** Fill in `docs/release-notes/v<version>.json`:

   ```json
   {
     "version": "1.2.0",
     "date": "2026-11-20",
     "en": { "summary": "…", "changes": ["New things"], "improvements": ["…"], "fixes": ["…"] },
     "fr": { "summary": "…", "changes": ["…"], "improvements": ["…"], "fixes": ["…"] }
   }
   ```

   Empty lists are left out. This one file becomes the GitHub release notes (`RELEASE_NOTES.md`),
   the "What's new" the app shows once after updating (bundled), and the notes of the update
   dialog in older versions (`latest.json`). `fr` is optional (English is used instead).
3. **Clean checkout.** Commit everything, then from a clean tree:

   ```
   npm ci
   npm run release
   ```

   The script:
   - downloads waifu2x-ncnn-vulkan, FFmpeg, rife-ncnn-vulkan and realesrgan-ncnn-vulkan at the
     versions pinned in `scripts/fetch-engine.mjs` and checks each archive's SHA-256;
   - builds the app in release mode (no devtools, no source maps, symbols stripped, LTO), with
     local paths (your user folder, the checkout folder, the cargo cache) remapped out of the
     binary, and stops if one is still there;
   - builds the NSIS installer from `src-tauri/windows/installer.nsi` and signs it with the
     updater key (see *Updates* below);
   - fills `release/v<version>/` with the installer, `latest.json` (update manifest),
     `LICENSE.txt`, `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_LICENSES.txt` (generated: full licence
     texts of every Rust crate and npm package compiled into the app), `RELEASE_NOTES.md` and
     `SHA256SUMS.txt`.
4. **Check before publishing.**
   - Windows Defender: `"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File <installer>`
   - VirusTotal: look the installer's SHA-256 up on <https://www.virustotal.com>; if it is
     unknown, upload it (it is a public file, it contains no secret). Machine-learning
     ("ml", "heuristic", "generic") detections on a new unsigned installer are usually false
     positives: report them to the vendor (contacts:
     <https://docs.virustotal.com/docs/false-positive-contacts>) with a link to this repository.
   - Install, launch, process an image, a GIF and a clip, uninstall, ideally on a clean
     Windows (a VM, or Windows Sandbox on Pro/Enterprise).
5. **Publish.** Create the GitHub Release `v<version>` (tag `v<version>`) on the release commit,
   paste `RELEASE_NOTES.md` as its description, and attach every file of `release/v<version>/`,
   **including `latest.json`**. Publish it as a normal release (not a draft or pre-release):
   `releases/latest/download/latest.json` only follows the latest full release. From then on,
   installed copies offer the update at their next launch, and the website rebuilds (its
   workflow runs on `release: published`) and links the new installer. Refresh
   `website/src/data/release-fallback.json` (size, digest, notes) so its offline fallback matches.
6. **Attach the installer to `updates` too**, before publishing the release (or right after):

   ```
   gh release upload updates release/v<version>/Aoze_<version>_x64-setup.exe
   ```

   `latest.json` sends installed copies to this copy, not to the one in `v<version>`, so the
   website's download counter only counts the downloads people start themselves (GitHub counts
   every download of an asset, and updates would count the same people again and again). Until
   it is attached, installed copies see the update but cannot download it.

   `updates` is a single pre-release that collects these copies; it is never "latest", so
   `releases/latest/...` and the website ignore it. It was created once with:

   ```
   gh release create updates --prerelease --title "Update downloads" --notes "Copies of the installers that Aoze's automatic updates download. To install Aoze, use the latest release."
   ```

The installer must keep the Tauri file name `Aoze_<version>_x64-setup.exe`: the website finds
it by the `_x64-setup.exe` suffix, and the app refuses any other name.

## Updates

Aoze 1.1.0 and later check `https://github.com/lololyeye/aoze/releases/latest/download/latest.json`
at launch (Settings → Updates turns it off). When a newer version is announced:

1. the app shows its notes and asks; nothing is downloaded before "Update now";
2. the installer is downloaded only from `https://github.com/lololyeye/aoze/releases/download/`
   (any other URL is refused; releases from 1.3.1 on point to the copy in the `updates`
   pre-release, see *Publish*), then checked: its minisign signature against the public key
   built into the app (`plugins.updater.pubkey` in `tauri.conf.json`), the version recorded in
   that signature against the announced one (`requireSignedVersion`: an older signed installer
   cannot be passed off as a new version), and its SHA-256 and size against `latest.json`;
3. the verified installer is kept in the app's cache folder (`updates`), so "Later" never means
   downloading it again; a broken or cancelled download leaves nothing behind;
4. on install (refused while a file is being processed) the installer runs in passive mode over
   the current installation, which stays untouched until then, and reopens Aoze. If it fails
   midway, running the installer again (or the one from the website) repairs the installation.

**The updater key.** `npm run release` signs with `TAURI_SIGNING_PRIVATE_KEY` (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), or else with `~/.tauri/aoze-updater.key`. Keep that file
safe and backed up, never commit it: without it no update can reach installed copies (a new key
means users must reinstall by hand once). Its public half is in `tauri.conf.json`.
`npm run build` does not need it (it builds no update artifacts).

To test the whole flow without publishing, a debug build accepts a local server: run
`npx tauri dev --config <file>` with `"version"` lower than the release and `plugins.updater`
pointing to `http://127.0.0.1:<port>/latest.json` (`"dangerousInsecureTransportProtocol": true`).
Release builds only accept GitHub.

## Reproducibility

Everything that goes into the installer is pinned: npm packages (`package-lock.json`), Rust
crates (`src-tauri/Cargo.lock`), the engines (version + SHA-256 in `scripts/fetch-engine.mjs`)
and the installer template (`src-tauri/windows/installer.nsi`). Two builds of the same commit
contain the same files. The binaries themselves are not bit-for-bit identical (compilers
write timestamps), so compare releases by their contents, not by their hash.

## Code signing

Releases are **not signed** for now. Windows therefore shows the publisher as "Unknown" and
SmartScreen may warn on download and on first launch ("Windows protected your PC" ->
"More info" -> "Run anyway") until the file has built up download reputation.

- A self-signed certificate does not help: Windows does not trust it, so it changes nothing
  for people downloading Aoze. Use one only to test the signing step itself.
- A publicly trusted signature needs a code signing certificate from a certificate
  authority, or a signing service. Options to look at:
  - **SignPath Foundation**: free code signing for open-source projects that qualify
    (<https://signpath.org>), signing from GitHub Actions.
  - **Azure Trusted Signing** (Microsoft): a low monthly fee, after identity validation;
    check that it is open to individuals in your country.
  - A standard (OV) or EV certificate from a CA (Sectigo, DigiCert, SSL.com, ...): paid
    yearly, private key on a hardware token or cloud HSM.
- Once a certificate is available, Tauri signs both the app and the installer if
  `bundle.windows.signCommand` (or `certificateThumbprint` + `timestampUrl`) is set in
  `src-tauri/tauri.conf.json`; the NSIS uninstaller is signed through the same setting.
  Keep the publisher name identical across releases so reputation carries over.

## What the installer does

Per-user install, no admin rights:

- Files: `%LOCALAPPDATA%\Aoze` (or the folder picked in Options): `aoze.exe`,
  `uninstall.exe`, and the `engine`, `ffmpeg`, `rife`, `realesrgan` folders.
- Shortcuts: Start menu `Aoze.lnk`; desktop `Aoze.lnk` if the box is ticked (default).
- Registry (all under `HKCU`): the uninstall entry
  `Software\Microsoft\Windows\CurrentVersion\Uninstall\Aoze`, the install folder in
  `Software\zero\Aoze`, and the "Open with Aoze" Explorer entry for .png .jpg .jpeg .webp .bmp
  .tif .tiff .gif .mp4 .mov .mkv .webm .avi .m4v under
  `Software\Classes\SystemFileAssociations\<ext>\shell\Aoze`.
- Network: only if the Microsoft WebView2 runtime is missing (it ships with Windows 11 and
  current Windows 10), the installer downloads Microsoft's official bootstrapper from
  `go.microsoft.com` and runs it.
- No service, scheduled task, start-with-Windows entry, or security setting.
- Temporary files: NSIS's own plug-in folder in `%TEMP%`, deleted when the installer closes.
- Uninstall removes the files, shortcuts and registry entries above. The user's settings and
  history (`%APPDATA%\app.aoze`, `%LOCALAPPDATA%\app.aoze`) are kept unless "Delete the
  application data" is ticked.

## What the app connects to

All processing runs on the PC through the bundled programs, started as child processes on the
user's files. Network activity comes only from:

- the update check at launch (GitHub, see *Updates*; can be turned off), and the installer
  download when the user accepts an update;

- links the user clicks (GitHub, Ko-fi), opened in the default browser; the app may only open
  `https://github.com/*` and `https://ko-fi.com/*`;
- the Microsoft Edge WebView2 runtime that draws the interface, which talks to Microsoft for
  its own updates and services.
