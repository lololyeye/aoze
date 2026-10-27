// Who publishes Aoze and its website. Every legal page reads its facts from here.
//
// A field left as null shows on the page as a visible "[À REMPLIR : …]" marker, and
// `npm run build` lists the missing fields. Fill them in (see LEGAL_TO_FILL.md at the
// root of the repository) before publishing the legal pages.

export const legal = {
  /** Name of the person, or company name, that publishes Aoze. */
  publisherName: "Zero",
  /** "Particulier", "Entrepreneur individuel (micro-entreprise)", "SAS", etc. */
  publisherStatus: "Particulier",
  /** SIREN / SIRET or company registration number. Leave null if there is none. */
  publisherRegistration: null as string | null,
  /** Person responsible for what is published on the site (often the publisher). */
  publicationDirector: "Zero et Aoxy",
  /** Contact email shown on every legal page. */
  contactEmail: "f3908770@gmail.com",
  /** Email for personal data requests. Leave null to use contactEmail. */
  privacyEmail: null as string | null,
  /** Country whose law applies to the terms, e.g. "France". */
  governingLaw: "France",

  /** The site is served by GitHub Pages (see .github/workflows/website.yml). */
  host: {
    name: "GitHub, Inc.",
    address: "88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States",
    url: "https://pages.github.com",
  },

  /** Date of the current version of the legal pages (YYYY-MM-DD). */
  updated: "2026-10-27",
};

export type LegalField = Exclude<keyof typeof legal, "host" | "updated">;

/** Fields the pages need. publisherRegistration is optional: it only applies to a business. */
export const required: LegalField[] = [
  "publisherName",
  "publisherStatus",
  "publicationDirector",
  "contactEmail",
  "governingLaw",
];

export const missing = required.filter((k) => !legal[k]);

if (missing.length) {
  console.warn(`[legal] Still to fill in src/data/legal.ts: ${missing.join(", ")}`);
}
