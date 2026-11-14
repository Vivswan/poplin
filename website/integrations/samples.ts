import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { Parser } from "htmlparser2";
import mime from "mime";

/** The file a request path names inside `folder`, or undefined when it names none or points outside it. */
function fileFor(folder: string, urlPath: string): string | undefined {
  const inside = normalize(join(folder, decodeURIComponent(urlPath.split("?")[0] ?? "")));
  if (inside !== folder && !inside.startsWith(folder + sep)) {
    return undefined;
  }
  const file = existsSync(inside) && statSync(inside).isDirectory() ? join(inside, "index.html") : inside;
  return existsSync(file) ? file : undefined;
}

/** The stylesheets, scripts, and images a page loads from its own folder, as the paths it names. */
function localFiles(html: string): string[] {
  const named: string[] = [];
  const parser = new Parser({
    onattribute: (name, value) => {
      // A local file is any address with no scheme, no host, and no leading slash: `./a.css` and `a.css` alike.
      if ((name === "href" || name === "src") && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) {
        named.push(value.replace(/^\.\//, "").split(/[?#]/)[0] ?? "");
      }
    },
  });
  parser.end(html);
  return named.filter((file) => file !== "");
}

/**
 * Puts the one sample site named `only` in `samplesDir` at `sample/<name>/`: served as it is while developing, copied into
 * the built site. The home page shows it in a frame, so a sample that is missing, or that names a file it does not have,
 * stops the build.
 */
export function samplesIntegration(samplesDir: string, only: string): AstroIntegration {
  const folder = normalize(join(samplesDir, only));
  let mount = `/sample/${only}`;
  return {
    name: "poplin-samples",
    hooks: {
      "astro:config:done": ({ config }) => {
        mount = `${config.base.replace(/\/$/, "")}/sample/${only}`;
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(mount, (request, response, next) => {
          const file = fileFor(folder, request.url ?? "/");
          if (file === undefined) {
            next();
            return;
          }
          response.setHeader("Content-Type", mime.getType(file) ?? "application/octet-stream");
          response.end(readFileSync(file));
        });
      },
      "astro:build:done": ({ dir }) => {
        if (!existsSync(join(folder, "index.html"))) {
          throw new Error(`The sample ${only} is missing from ${samplesDir}; the home page shows it in a frame.`);
        }
        const built = join(fileURLToPath(dir), "sample", only);
        cpSync(folder, built, { recursive: true });
        const missing = localFiles(readFileSync(join(built, "index.html"), "utf8")).filter((file) => !existsSync(join(built, file)));
        if (missing.length > 0) {
          throw new Error(`The sample ${only} names files the built site lacks: ${missing.join(", ")}`);
        }
      },
    },
  };
}
