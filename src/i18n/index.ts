import { useSettingsStore } from "../stores/settingsStore";
import type { Language } from "../types";
import { en, type Messages } from "./en";
import { fr } from "./fr";

const catalogs = { en, fr } as const;
export type Locale = keyof typeof catalogs;

export function resolveLocale(lang: Language | undefined): Locale {
  if (lang === "en" || lang === "fr") return lang;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function fmt(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function useMessages(): Messages {
  const lang = useSettingsStore((s) => s.settings?.language);
  return catalogs[resolveLocale(lang)];
}

export function useLocale(): Locale {
  return resolveLocale(useSettingsStore((s) => s.settings?.language));
}

export function messagesFor(lang: Language | undefined): Messages {
  return catalogs[resolveLocale(lang)];
}
