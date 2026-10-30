import type { Release } from "./types";

/** Pre-release holding the installer copies that latest.json points to. */
export const UPDATES_TAG = "updates";
export const RELEASES_URL = "https://github.com/lololyeye/aoze/releases";

export const publicReleases = (list: Release[]): Release[] => list.filter((r) => !r.prerelease);

/** latest.json is fetched by every installed copy that checks for updates, while its release is the latest. */
export const updateChecks = (r: Release): number => r.assets.find((a) => a.name === "latest.json")?.downloads ?? 0;

/**
 * GitHub's counters, split by who fetches the file. The updater's copy is replaced at each release,
 * so its count only covers the current version.
 */
export function downloadTotals(list: Release[]): { installer: number; updater: number; checks: number } {
  const published = publicReleases(list);
  return {
    installer: published.reduce((n, r) => n + (r.installer?.downloads ?? 0), 0),
    updater: list.find((r) => r.tag === UPDATES_TAG)?.downloads ?? 0,
    checks: published.reduce((n, r) => n + updateChecks(r), 0),
  };
}
