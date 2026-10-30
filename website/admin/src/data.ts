// Data for the dashboard. Releases and website builds are public on GitHub and read live; the
// account, sessions and history come from the admin API. Deployment, certificates, latest.json
// and the banner stay marked examples until the server serves them (phase 4).
import { api } from "./api";
import { sample } from "./sample";
import type { ActivityEntry, Dataset, LoginEntry, Release, SecuritySettings, SessionEntry, WorkflowRun } from "./types";

const REPO = "lololyeye/aoze";
const API = `https://api.github.com/repos/${REPO}`;
const INSTALLER = /_x64-setup\.exe$/i;

interface GitHubAsset {
  name: string;
  size: number;
  download_count: number;
  digest?: string | null;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  body_html?: string;
  assets: GitHubAsset[];
}

interface GitHubRun {
  status: WorkflowRun["status"];
  conclusion: WorkflowRun["conclusion"];
  head_sha: string;
  event: string;
  updated_at: string;
  html_url: string;
}

async function github<T>(path: string, accept = "application/vnd.github+json"): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: accept } });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub limite les requêtes sans compte : réessayez dans quelques minutes.");
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}.`);
  return (await res.json()) as T;
}

function toRelease(r: GitHubRelease): Release {
  const asset = r.assets.find((a) => INSTALLER.test(a.name) && a.browser_download_url.includes(`/releases/download/${r.tag_name}/`))
    ?? r.assets.find((a) => INSTALLER.test(a.name));
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/, ""),
    name: r.name ?? r.tag_name,
    publishedAt: r.published_at,
    url: r.html_url,
    prerelease: r.prerelease,
    installer: asset
      ? {
          name: asset.name,
          size: asset.size,
          downloads: asset.download_count,
          sha256: asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null,
          url: asset.browser_download_url,
        }
      : null,
    downloads: r.assets.filter((a) => INSTALLER.test(a.name)).reduce((n, a) => n + a.download_count, 0),
    notesHtml: r.body_html ?? null,
  };
}

async function live<T>(load: () => Promise<T>): Promise<Dataset<T>> {
  try {
    return { state: "live", data: await load(), fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { state: "unavailable", reason: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

let releasesCache: Promise<Dataset<Release[]>> | null = null;

export function releases(): Promise<Dataset<Release[]>> {
  releasesCache ??= live(async () => {
    const list = await github<GitHubRelease[]>("/releases?per_page=100", "application/vnd.github.full+json");
    return list.filter((r) => !r.draft).map(toRelease);
  });
  return releasesCache;
}

export const websiteRun = (): Promise<Dataset<WorkflowRun | null>> =>
  live(async () => {
    const { workflow_runs } = await github<{ workflow_runs: GitHubRun[] }>("/actions/workflows/website.yml/runs?per_page=1");
    const run = workflow_runs[0];
    return run
      ? { status: run.status, conclusion: run.conclusion, commit: run.head_sha, event: run.event, updatedAt: run.updated_at, url: run.html_url }
      : null;
  });

export const manifest = async () => sample.manifest;
export const deploy = async () => sample.deploy;
export const certificates = async () => sample.certificates;
export const pages = async () => sample.pages;
export const server = async () => sample.server;
export const announcement = async () => sample.announcement;
export const activity = () => live(() => api<ActivityEntry[]>("activity"));
export const logins = () => live(() => api<LoginEntry[]>("logins"));
export const sessions = () => live(() => api<SessionEntry[]>("sessions"));
export const security = () => live(() => api<SecuritySettings>("security"));
