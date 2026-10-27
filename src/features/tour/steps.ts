import type { Messages } from "../../i18n/en";
import type { Page } from "../../stores/uiStore";

/** One voice line per chapter (public/sounds/tour/<chapter>.ogg). */
export type Chapter = "intro" | "home" | "image" | "clip" | "convert" | "more" | "outro";
export type StepId = keyof Messages["tour"]["steps"];

export interface TourStep {
  id: StepId;
  chapter: Chapter;
  /** Page shown behind the step (opened when needed, e.g. on a replay). */
  page: Page;
  /** `data-tour` of the element to click; none: a centred card. */
  target?: string;
  /** Clicking the target opens this page, like the real button. */
  go?: Page;
}

export const STEPS: TourStep[] = [
  { id: "intro", chapter: "intro", page: "home" },
  { id: "home-image", chapter: "home", page: "home", target: "home-image" },
  { id: "home-clip", chapter: "home", page: "home", target: "home-clip" },
  { id: "home-convert", chapter: "home", page: "home", target: "home-convert" },
  { id: "home-drop", chapter: "home", page: "home", target: "home-drop" },
  { id: "nav-image", chapter: "image", page: "home", target: "nav-image", go: "image" },
  { id: "image-stage", chapter: "image", page: "image", target: "stage" },
  { id: "image-presets", chapter: "image", page: "image", target: "presets" },
  { id: "image-controls", chapter: "image", page: "image", target: "controls" },
  { id: "image-process", chapter: "image", page: "image", target: "process" },
  { id: "nav-clip", chapter: "clip", page: "image", target: "nav-clip", go: "clip" },
  { id: "clip-stage", chapter: "clip", page: "clip", target: "stage" },
  { id: "clip-presets", chapter: "clip", page: "clip", target: "presets" },
  { id: "clip-format", chapter: "clip", page: "clip", target: "clip-format" },
  { id: "clip-motion", chapter: "clip", page: "clip", target: "clip-motion" },
  { id: "clip-color", chapter: "clip", page: "clip", target: "clip-color" },
  { id: "clip-process", chapter: "clip", page: "clip", target: "process" },
  { id: "nav-convert", chapter: "convert", page: "clip", target: "nav-convert", go: "convert" },
  { id: "convert-kinds", chapter: "convert", page: "convert", target: "convert-kinds" },
  { id: "convert-options", chapter: "convert", page: "convert", target: "convert-options" },
  { id: "nav-history", chapter: "more", page: "convert", target: "nav-history", go: "history" },
  { id: "nav-settings", chapter: "more", page: "history", target: "nav-settings", go: "settings" },
  { id: "nav-help", chapter: "more", page: "settings", target: "nav-help", go: "help" },
  { id: "gpu", chapter: "more", page: "help", target: "gpu" },
  { id: "outro", chapter: "outro", page: "help" },
];
