/**
 * Where a piece of data comes from. The interface always shows it: an example is never
 * mistaken for a real figure, and missing data never reads as zero.
 */
export type Dataset<T> =
  | { state: "live"; data: T; fetchedAt: string }
  | { state: "sample"; data: T }
  | { state: "unavailable"; reason: string };

export interface Installer {
  name: string;
  size: number;
  downloads: number;
  sha256: string | null;
  url: string;
}

export interface Release {
  tag: string;
  version: string;
  name: string;
  publishedAt: string;
  url: string;
  prerelease: boolean;
  installer: Installer | null;
  /** Every asset of the release, including the copies used by automatic updates. */
  downloads: number;
  notesHtml: string | null;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ManifestStatus {
  version: string;
  url: string;
  sha256: string;
  size: number;
  checks: Check[];
}

export interface WorkflowRun {
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  commit: string;
  event: string;
  updatedAt: string;
  url: string;
}

export interface DeployStatus {
  builtCommit: string;
  liveCommit: string;
  lastPullAt: string;
  logTail: string[];
}

export interface CertificateStatus {
  host: string;
  issuer: string;
  validTo: string;
}

export interface PageStatus {
  path: string;
  status: number;
  ms: number;
}

export interface ServerStatus {
  php: string;
  database: string;
  databaseSize: number;
}

export type AnnouncementLevel = "info" | "warning";

export interface Announcement {
  status: "draft" | "published";
  level: AnnouncementLevel;
  textFr: string;
  textEn: string;
  link: string;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
}

export interface ActivityEntry {
  at: string;
  action: string;
  detail: string;
}

export interface LoginEntry {
  at: string;
  ip: string;
  success: boolean;
  device: string;
}

export interface SessionEntry {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string;
  device: string;
  current: boolean;
}

export interface SecuritySettings {
  twoFactor: boolean;
  passwordChangedAt: string;
  idleMinutes: number;
}
