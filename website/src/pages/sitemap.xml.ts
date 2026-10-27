import type { APIRoute } from "astro";
import { pageHref } from "../lib/site";
import { LANGS } from "../i18n/ui";

const pages = ["", "download/", "credits/", "license/"];

// Each page is listed in both languages, with its hreflang alternates.
export const GET: APIRoute = ({ site }) => {
  const url = (lang: "en" | "fr", p: string) => new URL(pageHref(lang, p), site).toString();
  const urls = pages.flatMap((p) =>
    LANGS.map((lang) => {
      const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(l, p)}"/>`).join("\n");
      return `  <url>\n    <loc>${url(lang, p)}</loc>\n${alts}\n  </url>`;
    }),
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml" } },
  );
};
