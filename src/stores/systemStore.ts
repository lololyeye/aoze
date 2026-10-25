import { create } from "zustand";
import { api } from "../services/api";
import type { GpuInfo, ModelCapabilities, Style, SystemCheck, SystemStatus } from "../types";

interface SystemState {
  status: SystemStatus | null;
  /** True until the first Vulkan detection has completed. */
  detecting: boolean;
  refreshing: boolean;
  /** Hardware profile and the tuning Aoze uses (startup check). */
  check: SystemCheck | null;
  loadCheck: () => Promise<void>;
  set: (s: SystemStatus, detected?: boolean) => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  detecting: true,
  refreshing: false,
  check: null,
  loadCheck: async () => {
    set({ check: await api.systemCheck() });
  },
  set: (status, detected = true) => set((st) => ({ status, detecting: st.detecting && !detected })),
  load: async () => {
    const status = await api.systemStatus();
    // Detection runs in the background at startup; an empty result with no
    // error means it has not finished yet.
    const detected = status.vulkan.available || status.vulkan.error !== null;
    set((st) => ({ status, detecting: st.detecting && !detected }));
  },
  refresh: async () => {
    set({ refreshing: true });
    try {
      set({ status: await api.refreshSystemStatus(), detecting: false });
    } finally {
      set({ refreshing: false });
    }
  },
}));

export function modelFor(status: SystemStatus | null, style: Style): ModelCapabilities | undefined {
  return status?.engine.models.find((m) => m.style === style);
}

export function activeGpu(status: SystemStatus | null, gpu: number | null): GpuInfo | undefined {
  const vk = status?.vulkan;
  if (!vk || gpu === -1) return undefined;
  const index = gpu ?? vk.defaultGpu;
  return vk.gpus.find((g) => g.index === index);
}
