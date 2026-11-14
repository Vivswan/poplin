import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { samplesIntegration } from "./integrations/samples.ts";

const samplesDir = process.env.POPLIN_SAMPLES_DIR || fileURLToPath(new URL("../demo/samples/", import.meta.url));

// The base path and origin come from the environment, so moving the site to another address changes no source file.
export default defineConfig({
  site: process.env.PAGES_ORIGIN || "http://localhost:4321",
  base: process.env.PAGES_BASE_PATH || "/",
  trailingSlash: "always",
  // Rasters are made at build time from the repository's own SVG drawings, so processing them is safe.
  image: { dangerouslyProcessSVG: true },
  // One sample folder stands in for a published page; the others stay out of the built site.
  integrations: [samplesIntegration(samplesDir, "sales-report")],
});
