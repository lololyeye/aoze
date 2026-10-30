// Everything the dashboard shows comes from the admin API: the server reads GitHub, the host and
// its own database, caches what it fetches, and dates every answer.
import { api, ApiError } from "./api";
import type {
  ActivityEntry, AnalyticsSettings, Announcement, CertificateStatus, Dataset, DeployStatus, LoginEntry, ManifestStatus, PageStatus,
  Release, SecuritySettings, ServerStatus, SessionEntry, WorkflowRun,
} from "./types";

interface Dated<T> {
  data: T;
  fetchedAt: string;
}

async function dated<T>(path: string): Promise<Dataset<T>> {
  try {
    const { data, fetchedAt } = await api<Dated<T>>(path);
    return { state: "live", data, fetchedAt };
  } catch (e) {
    return { state: "unavailable", reason: e instanceof ApiError ? e.message : "Le serveur ne répond pas." };
  }
}

async function plain<T>(path: string): Promise<Dataset<T>> {
  try {
    return { state: "live", data: await api<T>(path), fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { state: "unavailable", reason: e instanceof ApiError ? e.message : "Le serveur ne répond pas." };
  }
}

export const releases = () => dated<Release[]>("releases");
export const manifest = () => dated<ManifestStatus>("manifest");
export const websiteRun = () => dated<WorkflowRun | null>("build");
export const deploy = () => dated<DeployStatus>("deploy");
export const certificates = () => dated<CertificateStatus[]>("certificates");
export const pages = () => dated<PageStatus[]>("pages");
export const server = () => dated<ServerStatus>("server");
export const announcement = () => dated<Announcement>("announcement");
export const activity = () => plain<ActivityEntry[]>("activity");
export const logins = () => plain<LoginEntry[]>("logins");
export const sessions = () => plain<SessionEntry[]>("sessions");
export const security = () => plain<SecuritySettings>("security");
export const analyticsSettings = () => plain<AnalyticsSettings>("analytics/settings");
