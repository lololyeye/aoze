import { defineConfig } from "astro/config";

// Served by GitHub Pages from the repository: https://lololyeye.github.io/aoze/
export default defineConfig({
  site: "https://lololyeye.github.io",
  base: "/aoze",
  trailingSlash: "ignore",
  build: { format: "directory" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
