import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fcst.kai.edu.ua",
  // Cloudflare Pages віддає /faculty/departments/ як статичний HTML.
  build: { format: "directory" },
});
