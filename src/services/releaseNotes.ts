// Release notes bundled with the app: docs/release-notes/v<version>.json, the same files the
// release script turns into the GitHub release notes and the update manifest.
import type { Locale } from "../i18n";
import type { ReleaseNotes, ReleaseNotesBody } from "../types";

const files = import.meta.glob<ReleaseNotes>("../../docs/release-notes/v*.json", { eager: true, import: "default" });

/** Notes of an installed version, or null if it has none. */
export function bundledNotes(version: string): ReleaseNotes | null {
  return Object.values(files).find((n) => n.version === version) ?? null;
}

/** The notes in the interface language (English when there is no translation). */
export function notesIn(notes: ReleaseNotes, locale: Locale): ReleaseNotesBody {
  return (locale === "fr" && notes.fr) || notes.en;
}

export function hasNotes(body: ReleaseNotesBody): boolean {
  return body.changes.length + body.improvements.length + body.fixes.length > 0;
}
