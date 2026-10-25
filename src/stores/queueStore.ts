import { useMemo } from "react";
import { create } from "zustand";
import type { Job, MediaKind, ProgressEvent, QueueSnapshot } from "../types";

/** Sections with their own files: stills + GIFs, clips, and Convert. */
export type Group = "image" | "clip" | "convert";

/** Workspace a file of this kind goes to when processed. */
export const groupOf = (kind: MediaKind): Group => (kind === "video" ? "clip" : "image");

export const groupOfJob = (job: Job): Group => (job.purpose === "convert" ? "convert" : groupOf(job.source.kind));

interface QueueState {
  jobs: Job[];
  paused: boolean;
  activeJob: string | null;
  progress: Record<string, ProgressEvent>;
  /** Selected job per workspace. */
  selected: Record<Group, string | null>;
  /** Follow the processing job in the viewer until the user picks one manually. */
  followActive: boolean;
  applySnapshot: (s: QueueSnapshot) => void;
  applyProgress: (p: ProgressEvent) => void;
  select: (id: string | null, manual?: boolean) => void;
  setFollowActive: (v: boolean) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  jobs: [],
  paused: false,
  activeJob: null,
  progress: {},
  selected: { image: null, clip: null, convert: null },
  followActive: true,

  applySnapshot: (s) =>
    set((st) => {
      const byId = new Map(s.jobs.map((j) => [j.id, j]));
      const pick = (g: Group): string | null => {
        const current = st.selected[g];
        const active = s.activeJob ? byId.get(s.activeJob) : undefined;
        if (st.followActive && active && groupOfJob(active) === g) return active.id;
        if (current && byId.has(current)) return current;
        const last = [...s.jobs].reverse().find((j) => groupOfJob(j) === g);
        return last?.id ?? null;
      };
      const progress = Object.fromEntries(Object.entries(st.progress).filter(([id]) => id === s.activeJob));
      return { jobs: s.jobs, paused: s.paused, activeJob: s.activeJob, selected: { image: pick("image"), clip: pick("clip"), convert: pick("convert") }, progress };
    }),

  applyProgress: (p) => set((st) => ({ progress: { ...st.progress, [p.id]: p } })),

  select: (id, manual = true) =>
    set((st) => {
      const job = st.jobs.find((j) => j.id === id);
      if (!job) return {};
      return { selected: { ...st.selected, [groupOfJob(job)]: id }, followActive: manual ? false : st.followActive };
    }),
  setFollowActive: (v) => set({ followActive: v }),
}));

export interface QueueStats {
  total: number;
  idle: number;
  waiting: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export function queueStats(jobs: Job[]): QueueStats {
  const s: QueueStats = { total: jobs.length, idle: 0, waiting: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (const j of jobs) {
    if (j.status === "idle") s.idle++;
    else if (j.status === "waiting") s.waiting++;
    else if (j.status === "processing") s.processing++;
    else if (j.status === "completed") s.completed++;
    else if (j.status === "failed") s.failed++;
    else if (j.status === "cancelled") s.cancelled++;
    else s.skipped++;
  }
  return s;
}

/** Jobs of one workspace (stable array identity while the queue does not change). */
export function useGroupJobs(group: Group): Job[] {
  const jobs = useQueueStore((s) => s.jobs);
  return useMemo(() => jobs.filter((j) => groupOfJob(j) === group), [jobs, group]);
}

export function useSelectedJob(group: Group): Job | null {
  return useQueueStore((s) => s.jobs.find((j) => j.id === s.selected[group]) ?? null);
}
