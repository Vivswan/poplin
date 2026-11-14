import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

const MODULE_ID = "virtual:poplin-samples";
const RESOLVED_ID = `\0${MODULE_ID}`;
const TITLE = /<title[^>]*>([^<]*)<\/title>/i;
const META_TAG = /<meta\s[^>]*>/gi;
const DESCRIPTION_NAME = /\sname\s*=\s*["']description["']/i;
const CONTENT = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const GALLERY_PAGE = "index.html";

/** One sample site found under the samples folder, as the gallery lists it. */
interface Sample {
  /** The folder name, which is also the last segment of the sample's address. */
  readonly name: string;
  /** The text of the sample's own `<title>`, still HTML-escaped as the sample wrote it; empty when it has none. */
  readonly titleHtml: string;
  /** The sample's own meta description, still HTML-escaped as the sample wrote it; empty when it has none. */
  readonly descriptionHtml: string;
}

function readDescription(html: string): string {
  const tag = (html.match(META_TAG) ?? []).find((meta) => DESCRIPTION_NAME.test(meta));
  const content = tag === undefined ? null : CONTENT.exec(tag);
  return (content?.[1] ?? content?.[2] ?? "").trim();
}

function readSample(samplesDir: string, name: string): Sample | undefined {
  const indexFile = join(samplesDir, name, "index.html");
  // A folder named like the gallery's own page would be copied over it.
  if (name.startsWith(".") || name === GALLERY_PAGE || !existsSync(indexFile)) {
    return undefined;
  }
  const html = readFileSync(indexFile, "utf8");
  return { name, titleHtml: (TITLE.exec(html)?.[1] ?? "").trim(), descriptionHtml: readDescription(html) };
}

function listSamples(samplesDir: string): Sample[] {
  if (!existsSync(samplesDir)) {
    return [];
  }
  const folders = readdirSync(samplesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const names = folders.map((entry) => entry.name).sort();
  return names.map((name) => readSample(samplesDir, name)).filter((sample) => sample !== undefined);
}

/**
 * Lists the sample sites in `samplesDir` for the gallery page and copies each into the built site at `demo/<name>/`.
 * A missing or empty folder yields an empty list, so the site builds before any sample exists.
 */
export function samplesIntegration(samplesDir: string): AstroIntegration {
  const samples = listSamples(samplesDir);
  return {
    name: "poplin-samples",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: "poplin-samples",
                resolveId: (id: string) => (id === MODULE_ID ? RESOLVED_ID : undefined),
                load: (id: string) => (id === RESOLVED_ID ? `export const samples = ${JSON.stringify(samples)};` : undefined),
              },
            ],
          },
        });
      },
      "astro:build:done": ({ dir }) => {
        for (const sample of samples) {
          cpSync(join(samplesDir, sample.name), join(fileURLToPath(dir), "demo", sample.name), { recursive: true });
        }
      },
    },
  };
}
