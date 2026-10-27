// Who publishes Aoze and its website. Every legal page reads its facts from here.
//
// A field left as null shows on the page as a visible "[À REMPLIR : …]" marker, and
// `npm run build` lists the missing fields. Fill them in (see LEGAL_TO_FILL.md at the
// root of the repository) before publishing the legal pages.

export const legal = {
  /** Name of the person, or company name, that publishes Aoze. */
  publisherName: null as string | null,
  /** "Particulier", "Entrepreneur individuel (micro-entreprise)", "SAS", etc. */
  publisherStatus: null as string | null,
  /** Postal address of the publisher (or of the company's registered office). */
  publisherAddress: null as string | null,
  /** SIREN / SIRET or company registration number. Leave null if there is none. */
  publisherRegistration: null as string | null,
  /** Person responsible for what is published on the site (often the publisher). */
  publicationDirector: null as string | null,
  /** Contact email shown on every legal page. */
  contactEmail: null as string | null,
  /** Email for personal data requests. Leave null to use contactEmail. */
  privacyEmail: null as string | null,
  /** Country whose law applies to the terms, e.g. "France". */
  governingLaw: null as string | null,

  /** The site is served by GitHub Pages (see .github/workflows/website.yml). */
  host: {
    name: "GitHub, Inc.",
    address: "88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States",
    /** Check it on GitHub's own pages before filling it in. */
    phone: null as string | null,
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
  "publisherAddress",
  "publicationDirector",
  "contactEmail",
  "governingLaw",
];

export const missing = [
  ...required.filter((k) => !legal[k]),
  ...(legal.host.phone ? [] : ["host.phone"]),
];

if (missing.length) {
  console.warn(`[legal] Still to fill in src/data/legal.ts: ${missing.join(", ")}`);
}
