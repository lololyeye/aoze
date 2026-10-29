import { defineConfig } from "astro/config";

// The official site is https://aoze.fr/ (o2switch). SITE_URL and BASE_PATH can build a copy for
// another address; the former one, lololyeye.github.io/aoze, now only redirects to aoze.fr.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://aoze.fr",
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "ignore",
  build: { format: "directory" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
