/** Data from the server, dated, or the reason it is missing: missing data never reads as zero. */
export type Dataset<T> = { state: "live"; data: T; fetchedAt: string } | { state: "unavailable"; reason: string };

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
  /** Every installer of the release, including the copies used by automatic updates. */
  downloads: number;
  assets: Asset[];
  notesHtml: string | null;
}

export interface Asset {
  name: string;
  size: number;
  downloads: number;
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
  /** The draft differs from the banner that is live. */
  pendingChanges: boolean;
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
  /** /admin answers as a missing page to anyone without the access key. */
  hidden: boolean;
}

export interface AnalyticsSettings {
  enabled: boolean;
  retentionDays: number;
  retentionChoices: number[];
  /** Visits and download requests currently stored, before the retention purge. */
  sessions: number;
  downloads: number;
  oldestAt: string | null;
  /** Month of the DB-IP country database in use. */
  geoMonth: string | null;
  maintainedAt: string | null;
}

export interface SeriesPoint {
  day: string;
  sessions: number;
  visitors: number;
  pageviews: number;
  downloads: number;
  requested: number;
}

export interface PeriodSummary {
  from: string;
  to: string;
  /** Sums of the daily totals (sessions, pageviews, engaged_ms, the funnel steps…). */
  totals: Partial<Record<string, number>>;
  /** Distinct visitors over the period, null once its raw visits are past the retention period. */
  visitors: number | null;
  series: SeriesPoint[];
}

export interface AnalyticsReport {
  enabled: boolean;
  today: string;
  measuredSince: string | null;
  current: PeriodSummary & { dimensions: Partial<Record<string, Record<string, number>>> };
  /** The period of the same length just before. */
  previous: PeriodSummary;
  github: { since: string | null; series: { day: string; installer: number; updater: number }[] };
}

export interface LiveActivity {
  active: number;
  recent: { at: string; path: string; country: string }[];
}
