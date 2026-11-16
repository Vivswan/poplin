// Names a release from a folder of its files, as the website's build names one from its page: `bun run --cwd packages/providers/cloudflare check-bundle <folder>`.
//
// The folder holds what a release's page holds: the source archive and the three files `bundle` writes. Every rule of the website's build runs on them but one:
// no attestation exists outside a release's own run, so GitHub's command line is not asked. It ends with the entry the website would publish, or with the rule that refused.

import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { version } from "../../../cli/package.json";
import { pinReleases } from "../src/shared/release/deploy/pin-releases";

const [folder] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: check-bundle.ts <folder of a release's files>");

const page = resolve(folder);

using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-bundle-check-"));

const pins = await pinReleases([version], {
  fetch: async (url) => {
    const file = Bun.file(join(page, basename(new URL(url).pathname)));

    return (await file.exists()) ? new Response(await file.bytes()) : new Response("", { status: 404 });
  },
  run: () => Promise.resolve(0),
  scratch: scratch.path,
  say: (line) => console.log(line),
});

if (!Object.hasOwn(pins, version)) throw new Error(`release ${version} was not named from ${page}`);

console.log(JSON.stringify(pins));
