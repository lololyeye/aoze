import type { APIRoute } from "astro";
import { href } from "../lib/site";

// Crawlers read robots.txt at the domain's root: https://aoze.fr/robots.txt.
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(href("sitemap.xml"), site)}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
