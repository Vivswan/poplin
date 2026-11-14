import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

const MODULE_ID = "virtual:poplin-samples";
const RESOLVED_ID = `\0${MODULE_ID}`;
const TITLE = /<title[^>]*>([^<]*)<\/title>/i;

/** One sample site found under the samples folder, as a page shows it. */
interface Sample {
  /** The folder name, which is also the last segment of the sample's address. */
  readonly name: string;

  /** The text of the sample's own `<title>`, still HTML-escaped as the sample wrote it; empty when it has none. */
  readonly titleHtml: string;

  /** How many files the sample folder holds, at any depth. */
  readonly files: number;

  /** The size of those files together, in bytes. */
  readonly bytes: number;
}

function measureFolder(folder: string): { files: number; bytes: number } {
  const entries = readdirSync(folder, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile());
  const sizes = entries.map((entry) => statSync(join(entry.parentPath, entry.name)).size);
  return { files: sizes.length, bytes: sizes.reduce((total, size) => total + size, 0) };
}

function readSample(samplesDir: string, name: string): Sample | undefined {
  const indexFile = join(samplesDir, name, "index.html");
  if (name.startsWith(".") || !existsSync(indexFile)) {
    return undefined;
  }
  const html = readFileSync(indexFile, "utf8");
  const title = (TITLE.exec(html)?.[1] ?? "").trim();
  return { name, titleHtml: title, ...measureFolder(join(samplesDir, name)) };
}

function listSamples(samplesDir: string, only: string): Sample[] {
  if (!existsSync(join(samplesDir, only))) {
    return [];
  }
  const sample = readSample(samplesDir, only);
  return sample === undefined ? [] : [sample];
}

/**
 * Offers the one sample site named `only` in `samplesDir` to the pages and copies it into the built site at `sample/<name>/`.
 * A missing folder yields an empty list, so the site builds without it.
 */
export function samplesIntegration(samplesDir: string, only: string): AstroIntegration {
  const samples = listSamples(samplesDir, only);
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
          cpSync(join(samplesDir, sample.name), join(fileURLToPath(dir), "sample", sample.name), { recursive: true });
        }
      },
    },
  };
}
