# Releasing Aoze

How a public release is made, from the source code to the installer people download.

```
source code (this repository, a tagged commit)
  -> npm ci                      exact npm dependencies from package-lock.json
  -> npm run release             engines fetched + checked, app built, installer built
  -> release/v<version>/         installer, SHA256SUMS.txt, licences, release notes
  -> GitHub Release v<version>   the files above; the website links to the installer
  -> installer -> Aoze installed in %LOCALAPPDATA%\Aoze (per user, no admin rights)
```

## Requirements

- Windows 10/11 x64.
- Node.js 22+ and npm.
- Rust (stable, MSVC toolchain) and the Visual Studio C++ build tools.
- Internet access for the first build (npm, crates.io, the engine downloads, the NSIS
  toolchain that Tauri fetches itself).

## Steps

1. **Version.** Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`. The release script refuses to run if they differ.
2. **Release notes.** Write `docs/release-notes/v<version>.md`.
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
   - builds the NSIS installer from `src-tauri/windows/installer.nsi`;
   - fills `release/v<version>/` with the installer, `LICENSE.txt`, `THIRD_PARTY_NOTICES.md`,
     `THIRD_PARTY_LICENSES.txt` (generated: full licence texts of every Rust crate and npm
     package compiled into the app), `RELEASE_NOTES.md` and `SHA256SUMS.txt`.
4. **Check before publishing.**
   - Windows Defender: `"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File <installer>`
   - VirusTotal: look the installer's SHA-256 up on <https://www.virustotal.com>; if it is
     unknown, upload it (it is a public file, it contains no secret). Machine-learning
     ("ml", "heuristic", "generic") detections on a new unsigned installer are usually false
     positives: report them to the vendor (contacts:
     <https://docs.virustotal.com/docs/false-positive-contacts>) with a link to this repository.
   - Install, launch, process an image, a GIF and a clip, uninstall, ideally on a clean
     Windows (a VM, or Windows Sandbox on Pro/Enterprise).
5. **Publish.** Create the GitHub Release `v<version>` on the release commit, attach every file
   of `release/v<version>/`, and paste the SHA-256 of the installer in the notes. The website
   picks the latest release up by itself; refresh `website/src/data/release-fallback.json`
   (size, digest, notes) so its offline fallback matches.

The installer must keep the Tauri file name `Aoze_<version>_x64-setup.exe`: the website finds
it by the `_x64-setup.exe` suffix.

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

Aoze has no network code. All processing runs on the PC through the bundled programs, started
as child processes on the user's files. Network activity comes only from:

- links the user clicks (GitHub, Ko-fi), opened in the default browser; the app may only open
  `https://github.com/*` and `https://ko-fi.com/*`;
- the Microsoft Edge WebView2 runtime that draws the interface, which talks to Microsoft for
  its own updates and services.
