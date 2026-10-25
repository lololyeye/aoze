import type { APIRoute } from "astro";
import { href } from "../lib/site";

// Note: crawlers only read robots.txt at a domain's root. On lololyeye.github.io/aoze this file
// is informative; it takes effect if the site moves to its own domain.
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(href("sitemap.xml"), site)}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
