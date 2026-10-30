// Every external link on the site comes from here.
export const REPO = "lololyeye/aoze";
export const GITHUB_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const NOTICES_URL = `${GITHUB_URL}/blob/main/THIRD_PARTY_NOTICES.md`;
export const README_URL = `${GITHUB_URL}#readme`;
export const VIDEO_ENGINE_URL = `${GITHUB_URL}/blob/main/docs/VIDEO_ENGINE.md`;
export const KOFI_URL = "https://ko-fi.com/aoze_support";
export const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
export const API_RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
/** The Windows installer is the release asset Tauri names `<Product>_<version>_x64-setup.exe`. */
export const INSTALLER = /_x64-setup\.exe$/i;
/** Installer links are only taken from this repository's releases, the same rule as the app's updater. */
export const RELEASE_DOWNLOADS = `${RELEASES_URL}/download/`;

export type ReleaseAssets = { assets: { name: string; download_count: number }[] }[];

/** Downloads of the installer across all releases, as GitHub counts them (repeats included). */
export function installerDownloads(releases: ReleaseAssets): number {
  return releases
    .flatMap((r) => r.assets)
    .filter((a) => INSTALLER.test(a.name))
    .reduce((n, a) => n + a.download_count, 0);
}

/** Prefixes a site path with the site's base ("/" on aoze.fr). Use it for assets. */
export function href(path = ""): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

/** A page in a given language: English at the root, French under /fr/. */
export function pageHref(lang: "en" | "fr", path = ""): string {
  return href((lang === "fr" ? "fr/" : "") + path.replace(/^\//, ""));
}
