// Writes the website's file of releases an install may take, for the build that follows: `bun run --cwd packages/providers/cloudflare pin-releases <file>`.
// It needs GitHub's command line and a token for it in `GH_TOKEN`. The versions are those the changelog of this tree names: what the main branch released.

import { existsSync, mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releases } from "../../../../website/src/lib/changelog";
import { pinReleases } from "../src/shared/release/deploy/pin-releases";

const CHANGELOG = join(import.meta.dir, "..", "..", "..", "..", "CHANGELOG.md");

const [file] = process.argv.slice(2);
if (file === undefined) throw new Error("usage: pin-releases.ts <file to write>");

using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-pins-"));

const versions = releases(existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "").map((release) => release.version);
const pins = await pinReleases(versions, {
  fetch,
  run: (command) => Bun.spawn([...command], { stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exited,
  scratch: scratch.path,
  say: (line) => console.log(line),
});

await Bun.write(file, JSON.stringify(pins));
