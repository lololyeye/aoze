// Every external link on the site comes from here.
export const REPO = "lololyeye/aoze";
export const GITHUB_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
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
/**
 * Pre-release holding the copies of the installers that the app's automatic updates download
 * (see RELEASE.md). Not counted: the counter only shows downloads people start themselves.
 */
export const UPDATES_TAG = "updates";

type CountedRelease = { tag_name: string; assets: { name: string; download_count: number }[] };

/** Downloads of the installer across the versioned releases, as counted by GitHub. */
export function installerDownloads(releases: CountedRelease[]): number {
  return releases
    .filter((r) => r.tag_name !== UPDATES_TAG)
    .flatMap((r) => r.assets)
    .filter((a) => INSTALLER.test(a.name))
    .reduce((n, a) => n + a.download_count, 0);
}

/** Prefixes a site path with the GitHub Pages base ("/aoze/"). Use it for assets. */
export function href(path = ""): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

/** A page in a given language: English at the root, French under /fr/. */
export function pageHref(lang: "en" | "fr", path = ""): string {
  return href((lang === "fr" ? "fr/" : "") + path.replace(/^\//, ""));
}
