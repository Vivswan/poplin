// The install's jobs on the simulated Workflow, driven as Cloudflare drives them: an instance a copy, a step a round, with no request sent while it runs.
// Without these the job's class, its binding, and the copy's rounds could each pass their own tests and a large copy still never become a site.

import { introspectWorkflow, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { publishSite } from "@poplin/core/src/actions/publish/publish";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ADMIN, type ApiCalls, api, ask, BINDINGS, done, installOf, instance, OWNER, problemsOf, tokenOf, type World, world } from "../worker/support/install";

/** The files of the source: more than the first request copies, so its copy takes two steps of a job more. */
const FILES = 300;

/** How long a test waits for a job to end, in milliseconds. */
const JOB_MS = 20_000;

/** The bindings of an install whose Worker is bound to its Workflow. */
const BOUND = { ...BINDINGS, JOBS: env.JOBS };

let w: World;

/** A source of `FILES` files, and the API of an install bound to the Workflow. The clock is the runtime's own, as the steps of a job read no test's clock. */
async function arranged(): Promise<{ readonly calls: ApiCalls; readonly site: { readonly site: string } }> {
  w.clock.now = Date.now();
  const worker = instance(w);
  await ask(worker, `${ADMIN}/api/whoami`, {}, BOUND);
  const pages = Array.from({ length: FILES }, (_page, at) => ({ path: at === 0 ? "index.html" : `pages/${at}.html`, size: 1, contentType: "text/html", open: () => new Blob(["x"]).stream() }));
  const source = await publishSite(await installOf(w), { scope: "admin", holder: OWNER }, { name: "large", files: pages });
  if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

  return { calls: api(worker, await tokenOf(w, "admin"), (input, init) => ask(worker, input, init, BOUND)), site: { site: source.site.id } };
}

/** What a request of a copy answers, as far as these tests read it. */
interface Round {
  readonly site: { readonly files: number; readonly access: string } | null;
  readonly copy: { readonly upload: string; readonly copied: number | null };
}

async function begin(calls: ApiCalls, site: { readonly site: string }): Promise<Round> {
  return done<Round>(await calls.sites[":site"].duplicate.$post({ param: site, query: {}, json: { name: "large-copy" } }));
}

async function stored(): Promise<number> {
  return (await BINDINGS.SITES.list()).objects.length;
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("a copy as a job", () => {
  // Drift: the page no longer copies; a job that was never created, a class the binding does not find, or a step that could not start the install would leave every large copy an upload that runs out.
  test("a copy of 300 files is started as one instance named by its upload, and is a private site with every file once the instance ends, with no request sent meanwhile", async () => {
    const { calls, site } = await arranged();
    await using jobs = await introspectWorkflow(env.JOBS);

    const first = await begin(calls, site);
    const instances = await jobs.get();
    await instances[0]?.waitForStatus("complete");
    const after = await done<Round>(await calls.sites[":site"].duplicate.$post({ param: site, query: {}, json: { upload: first.copy.upload } }));

    expect([first.site, first.copy.copied, instances.length, (await (await env.JOBS.get(first.copy.upload)).status()).status]).toEqual([null, 112, 1, "complete"]);
    expect([after.site, after.copy.copied, await stored(), await problemsOf(w)]).toEqual([{ ...after.site, files: FILES, access: "private" }, FILES, 2 * FILES, []]);
  }, JOB_MS);

  // Drift: Cancel must be true whoever runs the copy; an instance left running after it would go on copying files nobody wants, a step at a time.
  test("a cancelled copy's instance ends, terminated or done, and the copy never becomes a site", async () => {
    const { calls, site } = await arranged();
    await using _jobs = await introspectWorkflow(env.JOBS);

    const first = await begin(calls, site);
    await done(await calls.uploads[":upload"].$delete({ param: { upload: first.copy.upload }, query: {} }));
    const ended = await vi.waitFor(
      async () => {
        const { status } = await (await env.JOBS.get(first.copy.upload)).status();
        expect(["terminated", "complete"]).toContain(status);

        return status;
      },
      { timeout: JOB_MS, interval: 100 },
    );
    const asked = await calls.sites[":site"].duplicate.$post({ param: site, query: {}, json: { upload: first.copy.upload } });
    const listed = await done<{ sites: unknown[] }>(await calls.sites.$get({ query: {} }));

    expect([typeof ended, asked.status, listed.sites.length, await problemsOf(w)]).toEqual(["string", 404, 1, []]);
  }, JOB_MS);

  // Drift: nobody watches a job; a round that fails for good and is not given up leaves the copy's files in the bucket and an upload "copying" for a day, with nothing in Problems.
  test("a round that fails at every try is given up after the last: the instance ends in error, the copy's files are removed, and the problem `copy_failed` is noted once", async () => {
    using _logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls, site } = await arranged();
    await using jobs = await introspectWorkflow(env.JOBS);
    await jobs.modifyAll(async (job) => {
      await job.disableRetryDelays();
      await job.mockStepError({ name: "round 1" }, new Error("the bucket is away"));
    });

    const first = await begin(calls, site);
    const [failed] = await jobs.get();
    await failed?.waitForStatus("errored");
    const asked = await calls.sites[":site"].duplicate.$post({ param: site, query: {}, json: { upload: first.copy.upload } });

    expect([asked.status, await stored(), (await problemsOf(w)).map((problem) => (problem as unknown[]).slice(0, 2))]).toEqual([404, FILES, [["copy_failed", 1]]]);
  }, JOB_MS);
});
