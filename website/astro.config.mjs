import { defineConfig } from "astro/config";

// The official site is https://aoze.fr/ (o2switch). The workflow can build another copy, for
// GitHub Pages at https://lololyeye.github.io/aoze/, by setting SITE_URL and BASE_PATH.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://aoze.fr",
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "ignore",
  build: { format: "directory" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
