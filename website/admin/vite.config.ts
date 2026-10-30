import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The admin is its own small app, built apart from the public site, reusing its tokens, fonts and
// favicon. The shell holds no data: everything it shows comes from the session-checked API.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  base: "/admin/",
  // In development the PHP API runs on `php -S 127.0.0.1:8090 dev-router.php` (see admin/README.md).
  server: { port: 4322, strictPort: true, proxy: { "/admin/api": "http://127.0.0.1:8090" } },
  build: {
    outDir: fileURLToPath(new URL("../dist-admin", import.meta.url)),
    emptyOutDir: true,
  },
});
