// Build the dashboard's client into `dist/`: one script, one stylesheet, and the font files, each under a name that holds a hash of its content, and a manifest that says which is which.
//
// Under `bun run preview --dev` the same config runs the dev server: it serves the client's own source, hot, and sends every other request to the preview server.

import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The preview server the dev server stands in front of, as `bun run preview --dev` names it. */
const PREVIEW = process.env.POPLIN_PREVIEW_ORIGIN;

/** Every path that is not the dev server's own: the pages, the data, and the sample sites are the preview's. */
const NOT_OWN = "^/(?!@|__|src/|node_modules/)";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  // The stylesheet names its fonts beside itself, so the files work under whatever path the host serves them at.
  base: "./",
  server: PREVIEW === undefined ? {} : { host: "127.0.0.1", strictPort: true, proxy: { [NOT_OWN]: { target: PREVIEW } } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    // The host reads the names of the script and the stylesheet from it: `.vite/manifest.json`.
    manifest: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/main.tsx"),
      output: { entryFileNames: "app-[hash].js", assetFileNames: (asset) => (asset.names.some((name) => name.endsWith(".css")) ? "app-[hash].css" : "[name]-[hash][extname]") },
    },
  },
});
