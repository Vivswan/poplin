// The checks a token holder starts: a site published, changed, and removed through the CLI and the MCP server, and what a stranger then gets at each of its addresses.

import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JobRun } from "../../../packages/providers/cloudflare/scripts/live/job-run";
import { type Bench, type Check, type LiveSite, Skip } from "../records";
import { expectRefused, GHOST_ID, siteOf, under } from "../util";

/** The content type of a page as the install stores it. */
const HTML = /^text\/html\b/;

/** The cache rule of a page anyone may open: any cache may keep it for a stated time. */
const SHARED_CACHE = /^public, max-age=\d+(?:, must-revalidate)?$/;

/** The statuses the edge answers with when no origin stands behind a hostname. */
const EDGE_ORIGIN_ERRORS: ReadonlySet<number> = new Set([520, 521, 522, 523, 525, 526, 530]);

/** Why the public name's address is skipped on an install whose routes do not reach it. */
const NO_PUBLIC_ROUTE = "a Worker route for the public word's hostnames";

/** The public name of the site that holds the demo on the test install. */
const DEMO = "demo";

/** Why the demo's check is skipped on an install that holds no such site. */
const NO_DEMO = "a public site named demo, which the reset of the test install publishes";

/** How many files the copied site holds: more than a copy took in one request when a request copied fifteen, and few enough to cost a run little. */
const COPIED_FILES = 16;

/** How long the provider may take to say that a job ended once its copy is a site, in milliseconds, and how long one look waits for the next: it says so a moment after the last step did. */
const JOB_ENDS_WITHIN = { ms: 30_000, pause: 2000 } as const;

/** The form of a problem's code, as the CLI names its own: a code of any other form is shown as `other`, so a failure prints no text an install chose. */
const CODE = /^[a-z_]{1,40}$/;

/** The content type of a script as the install stores it. */
const SCRIPT = /^text\/javascript\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Open an address as a stranger and fail unless the page's whole text comes back. */
async function expectOpens(bench: Bench, address: string, text: string): Promise<Response> {
  const response = await bench.visit(address);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(text);

  return response;
}

/** The name of a page beside the first, by its place: with as many digits each, so the bucket lists the pages in that order, and the last of them is the last file a copy takes. */
function pageName(at: number): string {
  return `page-${String(at).padStart(4, "0")}.html`;
}

/** What a copy of a site the check published came to: the upload that held it, how many files the last answer counted as stored, the requests and the time the command took, and the bytes of the source's pages. */
interface Copied {
  readonly upload: string;
  readonly stored: number | null;
  readonly rounds: number;
  readonly took: number;
  readonly bytes: number;
}

/**
 * Publish a site of so many pages, copy it with the CLI, and fail unless the copy is a private site of its own that holds the source's pages.
 *
 * The copy's files are read as a stranger reads them, once the copy is unlisted: its first page, and the first and the last of the others. The last is the last file a copy takes.
 */
async function copyOfPages(bench: Bench, site: { readonly files: number; readonly name: string; readonly text: string }): Promise<Copied> {
  const { files, text } = site;
  const path = bench.folder(text);
  const pages = Array.from({ length: files - 1 }, (_page, at) => `<p>page ${at}</p>`);
  for (const [at, page] of pages.entries()) writeFileSync(join(path, pageName(at)), page);

  const source = siteOf(await bench.cli("publish", path, "--name", site.name, "--unlisted", "--expires", "1d"));
  const [asked, began] = [bench.asked(), bench.now()];
  const copied = await bench.cli("duplicate", source.label);
  const [rounds, took] = [bench.asked() - asked, bench.now() - began];

  // A request the host ends, as one that ran past its processing time, answers no site: the command then fails, and the code of its problem is what the failure shows.
  const problem = (copied.value.error as { readonly code?: string } | undefined)?.code;
  expect({ code: copied.code, problem: problem === undefined || CODE.test(problem) ? problem : "other" }).toEqual({ code: 0, problem: undefined });
  const copy = copied.value.site as LiveSite;
  const { upload, copied: stored, files: held } = copied.value.copy as { readonly upload: string; readonly copied: number | null; readonly files: number };
  // Only what the check chose is compared, so a failure shows no address.
  expect({ name: copy.name === source.name, access: copy.access, version: copy.live_version, own: copy.id !== source.id, files: held }).toEqual({ name: true, access: "private", version: 1, own: true, files });
  await expectRefused(bench.addresses, await bench.visit(copy.url), text);

  const opened = siteOf(await bench.cli("set", copy.label, "--unlisted"));
  expect(opened.id === copy.id).toBe(true);
  await expectOpens(bench, opened.url, text);
  for (const at of [0, pages.length - 1]) await expectOpens(bench, under(opened.url, pageName(at)), pages[at] ?? "");

  return { upload, stored, rounds, took, bytes: [text, ...pages].reduce((sum, page) => sum + page.length, 0) };
}

/** Look at the provider's account of a job until it is no longer running, or its time is up, and answer what the provider then says of it. */
async function endedJob(bench: Bench, upload: string): Promise<JobRun> {
  const until = bench.now() + JOB_ENDS_WITHIN.ms;

  for (;;) {
    const job = await bench.jobRun(upload);
    if (job.state !== "running" || bench.now() >= until) return job;

    await bench.pause(JOB_ENDS_WITHIN.pause);
  }
}

/** Every check a token holder starts. */
export const LIFECYCLE_CHECKS: readonly Check[] = [
  {
    id: "private",
    name: "a new private site hands a stranger nothing, and answers as an address nobody has",
    needs: ["token"],
    run: async (bench) => {
      const { site, text } = await bench.shared("private");
      expect(site).toMatchObject({ access: "private", state: "live", live_version: 1, url: bench.addresses.answered(site.label, "p") });

      await expectRefused(bench.addresses, await bench.visit(site.url), text);

      const real = await bench.visit(bench.addresses.site(site.id, "u"));
      const ghost = await bench.visit(bench.addresses.site(GHOST_ID, "u"));
      expect(real.status).toBe(ghost.status);
      expect(real.headers.get("Location")?.replaceAll(site.id, GHOST_ID)).toBe(ghost.headers.get("Location") ?? undefined);
      await expectRefused(bench.addresses, real, text);
    },
  },
  {
    id: "unlisted",
    name: "an unlisted site opens for a stranger at every form of its address, with the file headers",
    needs: ["token"],
    run: async (bench) => {
      const { site, text } = await bench.shared("unlisted");
      const { addresses } = bench;
      expect(site).toMatchObject({ access: "unlisted", url: addresses.answered(site.label, "u") });

      const response = await expectOpens(bench, site.url, text);
      expect(response.headers.get("Content-Type")).toMatch(HTML);
      expect(response.headers.get("Cache-Control")).toMatch(SHARED_CACHE);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response.headers.get("Content-Security-Policy")).toBe(`frame-ancestors ${addresses.frameSources}`);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

      await expectOpens(bench, addresses.site(site.id, "u"), text);
      await expectOpens(bench, addresses.site(`another-name--${site.id}`, "u"), text);
      // A layout whose host says the side of a site has no address without a letter.
      const bare = addresses.letterless(site.label);
      if (bare !== undefined) await expectOpens(bench, bare, text);
    },
  },
  {
    id: "relative-file",
    name: "a file beside a site's page opens at the address a relative link of the page leads to, and an address without its last slash moves to the one with it",
    needs: ["token"],
    run: async (bench) => {
      const { site, beside } = await bench.shared("unlisted");
      const page = bench.addresses.site(site.label, "u");

      // Only a layout where a site is a path has such an address: under it a browser would resolve the page's links against the host's root.
      const unslashed = bench.addresses.unslashed(site.label, "u");
      if (unslashed !== undefined) {
        const moved = await bench.visit(`${unslashed}?from=link`);
        // Compared here and told as one word: a failure prints no address.
        expect([moved.status, moved.headers.get("Location") === `${page}?from=link`]).toEqual([302, true]);
      }

      await expectOpens(bench, new URL(beside.path, page).href, beside.text);
    },
  },
  {
    id: "public",
    name: "a public site claims its public name and opens at its label address",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>public one</p>";
      const site = await bench.publish({ access: "public", text });
      expect(site).toMatchObject({ access: "public", url: site.addresses.public });
      expect(site.addresses.public).not.toBeNull();

      await expectOpens(bench, site.addresses.site, text);
    },
  },
  {
    id: "public-name",
    name: "a public site opens at its public name, and stops when it is no longer public",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>public two</p>";
      const site = await bench.publish({ access: "public", text });
      const address = site.addresses.public ?? "";

      // A hostname no route reaches is answered by the edge alone: no answer, or one of its own origin errors.
      const first = await bench.visit(address).catch(() => undefined);
      if (first === undefined || EDGE_ORIGIN_ERRORS.has(first.status)) throw new Skip(NO_PUBLIC_ROUTE);

      expect(first.status).toBe(200);
      expect(await first.text()).toBe(text);

      siteOf(await bench.cli("set", site.label, "--unlisted"));
      const after = await bench.visit(address);
      expect(after.status).toBe(404);
      await expectRefused(bench.addresses, after, text);
    },
  },
  {
    id: "demo",
    name: "the demo opens at its public name, and its worker is served as a script",
    needs: ["token"],
    run: async (bench) => {
      const shown = await bench.cli("show", DEMO);
      if (isRecord(shown.value.error) && shown.value.error.code === "not_found") throw new Skip(NO_DEMO);

      const address = siteOf(shown).addresses.public ?? "";
      const first = await bench.visit(address).catch(() => undefined);
      if (first === undefined || EDGE_ORIGIN_ERRORS.has(first.status)) throw new Skip(NO_PUBLIC_ROUTE);

      expect({ status: first.status, type: first.headers.get("Content-Type") }).toEqual({ status: 200, type: expect.stringMatching(HTML) });

      // A browser registers a worker only from a script's media type: the install sends `nosniff` with every file.
      const worker = await bench.visit(under(address, "sw.js"));
      expect({ status: worker.status, type: worker.headers.get("Content-Type") }).toEqual({ status: 200, type: expect.stringMatching(SCRIPT) });
    },
  },
  {
    id: "update-rollback",
    name: "an update is served at the same address, and a rollback serves the version before it",
    needs: ["token"],
    run: async (bench) => {
      const site = await bench.publish({ access: "unlisted", text: "<p>version one</p>" });

      const updated = siteOf(await bench.cli("publish", bench.folder("<p>version two</p>"), "--site", site.label));
      expect(updated).toMatchObject({ id: site.id, url: site.url, live_version: 2 });
      await expectOpens(bench, site.url, "<p>version two</p>");

      expect(siteOf(await bench.cli("rollback", site.label))).toMatchObject({ id: site.id, live_version: 1 });
      await expectOpens(bench, site.url, "<p>version one</p>");
    },
  },
  {
    id: "rename",
    name: "a renamed site keeps its id, and opens under the old name and the new",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>renamed</p>";
      const site = await bench.publish({ access: "unlisted", text });
      const name = `${site.name}-new`;

      const renamed = siteOf(await bench.cli("set", site.label, "--name", name));
      expect(renamed).toMatchObject({ id: site.id, name, url: bench.addresses.answered(`${name}--${site.id}`, "u") });
      await expectOpens(bench, renamed.url, text);
      await expectOpens(bench, site.url, text);
    },
  },
  {
    id: "new-link",
    name: "a new link opens at the new address, and the old address stops at once",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>new link</p>";
      const site = await bench.publish({ access: "unlisted", text });

      const linked = siteOf(await bench.cli("new-link", site.label));
      expect(linked.id).not.toBe(site.id);
      await expectOpens(bench, linked.url, text);
      await expectRefused(bench.addresses, await bench.visit(site.url), text);
    },
  },
  {
    id: "set-private",
    name: "an unlisted site set private stops opening for a stranger, and opens again once unlisted",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>set private</p>";
      const site = await bench.publish({ access: "unlisted", text });

      const hidden = siteOf(await bench.cli("set", site.label, "--private"));
      expect(hidden).toMatchObject({ id: site.id, access: "private", url: bench.addresses.answered(site.label, "p") });
      await expectRefused(bench.addresses, await bench.visit(site.url), text);

      expect(siteOf(await bench.cli("set", site.label, "--unlisted")).url).toBe(site.url);
      await expectOpens(bench, site.url, text);
    },
  },
  {
    id: "delete-restore",
    name: "a deleted site stops opening and is listed in the trash, and a restored one opens again",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>delete restore</p>";
      const site = await bench.publish({ access: "unlisted", text });

      expect(siteOf(await bench.cli("delete", site.label)).state).toBe("trash");
      await expectRefused(bench.addresses, await bench.visit(site.url), text);

      const trash = await bench.cli("list", "--trash");
      expect((trash.value.sites as readonly LiveSite[]).map((listed) => listed.id)).toContain(site.id);

      expect(siteOf(await bench.cli("restore", site.label)).state).toBe("live");
      await expectOpens(bench, site.url, text);
    },
  },
  {
    id: "duplicate",
    name: "a copy of a site is a private site of its own that holds the source's pages, and the run says how long the copy took",
    needs: ["token"],
    run: async (bench) => {
      const made = await copyOfPages(bench, { files: COPIED_FILES, name: `${bench.prefix}-copied`, text: "<p>duplicate</p>" });
      expect(made.stored).toBe(COPIED_FILES);

      bench.say(`duplicate: ${COPIED_FILES} files, ${made.bytes} bytes, ${made.rounds} rounds, ${made.took} ms`);
    },
  },
  {
    id: "duplicate-job",
    name: "a copy too large for one request is finished by the install's own job, and the run says how many steps it ran and how long it took",
    needs: ["token", "jobs", "job-copy"],
    run: async (bench) => {
      const made = await copyOfPages(bench, { files: bench.largeCopy, name: `${bench.prefix}-copied-large`, text: "<p>duplicate by a job</p>" });

      // The provider's own account of the job: a copy the command's requests made has none there, and one whose job failed is told as failed.
      const job = await endedJob(bench, made.upload);
      expect({ state: job.state, ran: job.steps > 0 }).toEqual({ state: "done", ran: true });

      bench.say(`duplicate-job: ${bench.largeCopy} files, ${made.bytes} bytes, ${job.steps} steps, ${made.took} ms`);
    },
  },
  {
    id: "mcp",
    name: "the MCP server publishes a site a stranger can open, and shows it again",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>over mcp</p>";
      const published = await bench.mcp("publish_site", { path: bench.folder(text), name: `${bench.prefix}-mcp`, access: "unlisted", expires: "1d" });
      const site = published.site as LiveSite;
      await expectOpens(bench, site.url, text);

      const shown = await bench.mcp("get_site", { site: site.label });
      expect(shown.site).toMatchObject({ id: site.id, url: site.url, access: "unlisted" });
    },
  },
  {
    id: "export-import",
    name: "an exported site is imported back under the id it had, beside the site that moved to a new id",
    needs: ["token"],
    run: async (bench) => {
      const text = "<p>export import</p>";
      const site = await bench.publish({ access: "unlisted", text });
      const zip = bench.scratchFile(`${site.id}.zip`);
      expect((await bench.cli("export", site.label, "--out", zip)).code).toBe(0);

      const moved = siteOf(await bench.cli("new-link", site.label));
      expect((await bench.cli("import", zip)).code).toBe(0);

      expect(siteOf(await bench.cli("show", site.id))).toMatchObject({ id: site.id, name: site.name, access: "unlisted", state: "live" });
      await expectOpens(bench, site.url, text);
      await expectOpens(bench, moved.url, text);
    },
  },
];
