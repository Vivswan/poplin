// What a copy too large for one request may cost on an install whose Worker is bound to its Workflow: the requests around the job, and each step of the job as one invocation.

import type { Job } from "@poplin/core/src/jobs/jobs";
import { parseUploadId } from "@poplin/core/src/records/upload";
import { giveUpStep, roundStep } from "../../../src/jobs/workflow";
import { siteFolder, siteId, siteWithFiles } from "./budget-seeds";
import { adminToken, apiOf, type BudgetRow, type Measured, post, sessionOf, type Stage, type Step, unmeasured } from "./budget-stage";
import { BINDINGS, done, sweep } from "./install";

/** The group of the requests around a job. */
const PUBLISHING = "Publishing";

/** The group of a job's steps. */
const BACKGROUND = "Background work";

/** The files of a version the bucket lists in two pages: one more than a page holds. A round of its copy copies 113 files, the most a round ever does. */
const TWO_PAGES = 1001;

/** The files one round of such a copy copies. */
const COPIED_A_ROUND = 113;

/** The rounds after the first request's that copy the last files of such a copy: the round after them only makes the site. */
const ROUNDS_TO_WHOLE = 8;

/** The milliseconds of one hour. */
const HOUR_MS = 3_600_000;

/** The label of the made-up site 1, as the dashboard's addresses name a site. */
const LABEL = `site-1--${siteId(1)}`;

/** What names the made-up site 1 in a route of the API. */
const SOURCE = { site: siteId(1) };

/** A Workflow that runs nothing: it takes every job, as Cloudflare's does, and no step of one runs beside the measured request. */
export function idleWorkflow(): Workflow<Job> {
  const instance: Pick<WorkflowInstance, "terminate"> = { terminate: async () => undefined };
  const workflow: Pick<Workflow<Job>, "create" | "get"> = { create: async () => instance as WorkflowInstance, get: async () => instance as WorkflowInstance };

  return workflow as Workflow<Job>;
}

/** Begin a copy of a site of 1,001 files through the API of an install with no Workflow, unmeasured, and run so many of its later rounds there. */
async function begunCopy(stage: Stage, rounds = 0): Promise<{ readonly job: Job; readonly token: string }> {
  await siteWithFiles(stage, TWO_PAGES);
  const token = await adminToken(stage);
  const calls = apiOf(unmeasured(stage), token);
  const begun = await done<{ copy: { upload: string } }>(await calls.sites[":site"].duplicate.$post({ param: SOURCE, query: {}, json: { name: "copy" } }));
  const upload = parseUploadId(begun.copy.upload);
  if (upload === undefined) throw new Error("the row's copy named no upload");

  for (let round = 0; round < rounds; round += 1) await done(await calls.sites[":site"].duplicate.$post({ param: SOURCE, query: {}, json: { upload } }));

  return { job: { kind: "copy", upload }, token };
}

/**
 * One step of a job on the measured instance: what Cloudflare runs as one invocation. It answers nothing.
 *
 * @param ends - what the step must answer, so that a row measures the work it names and no round that found nothing to do
 */
function step<Ended>(work: (started: Awaited<ReturnType<Measured["worker"]["starting"]>>) => Promise<Ended>, ends: Ended): Step {
  return async (measured) => {
    const ended = await work(await measured.worker.starting(measured.bindings));
    if (ended !== ends) throw new Error(`the row's step answered ${String(ended)}, where its work answers ${String(ends)}`);

    return undefined;
  };
}

/** The uploads of copies by their state, read beside a step: what proves a step that ends a copy did. */
async function copyStates(): Promise<readonly string[]> {
  const { results } = await BINDINGS.DB.prepare("SELECT state FROM uploads WHERE json_extract(plan, '$.kind') = 'duplicate'").all<{ state: string }>();

  return results.map((row) => row.state);
}

export const JOBS_ROWS: readonly BudgetRow[] = [
  {
    group: PUBLISHING,
    name: "duplicate a site of 1,001 files: first round, which starts the job",
    route: "POST /api/sites/:site/duplicate",
    // Worst of a first round: a version listed in two pages, where a call copies the most files it ever does, and the job is handed to the Workflow.
    arrange: async (stage) => {
      stage.jobs = idleWorkflow();
      await siteWithFiles(stage, TWO_PAGES);
      const token = await adminToken(stage);

      return (measured) => apiOf(measured, token).sites[":site"].duplicate.$post({ param: SOURCE, query: {}, json: { name: "copy" } });
    },
    status: 200,
    budget: { queries: 5, reads: 113, writes: 115 },
  },
  {
    group: PUBLISHING,
    name: "duplicate a site of 1,001 files: an ask after the copy while its job runs",
    route: "POST /api/sites/:site/duplicate",
    // Every ask of a client that waits: the source and the upload are read, and the bucket is not asked.
    arrange: async (stage) => {
      stage.jobs = idleWorkflow();
      const { job, token } = await begunCopy(stage);

      return (measured) => apiOf(measured, token).sites[":site"].duplicate.$post({ param: SOURCE, query: {}, json: { upload: job.upload } });
    },
    status: 200,
    budget: { queries: 3, written: 0, reads: 0, writes: 0 },
  },
  {
    group: "Each dashboard screen",
    name: "Sites screen: an ask after a copy of 1,001 files while its job runs",
    route: "POST /data/sites/:site/duplicate",
    // Every ask of a page that waits: the source and the upload are read, and the bucket is not asked.
    arrange: async (stage) => {
      stage.jobs = idleWorkflow();
      const { job } = await begunCopy(stage);
      const session = await sessionOf(stage);

      return (measured) => post(measured, `/data/sites/${LABEL}/duplicate`, { upload: job.upload }, session);
    },
    status: 200,
    budget: { queries: 3, written: 0, reads: 0, writes: 0 },
  },
  {
    group: BACKGROUND,
    name: "a job's step: a round of a copy of 1,001 files",
    // Worst of a round: the copy is listed in two pages for what it lacks, and as many files are copied as a round ever copies.
    arrange: async (stage) => {
      const { job } = await begunCopy(stage);

      return step((started) => roundStep(started, job), "more");
    },
    status: undefined,
    budget: { queries: 2, reads: 113, writes: 114 },
  },
  {
    group: BACKGROUND,
    name: "a job's step: a round of a copy of 1,001 files, new instance",
    start: "new",
    // What a step costs where Cloudflare starts an instance for it: the round, and the start.
    arrange: async (stage) => {
      const { job } = await begunCopy(stage);

      return step((started) => roundStep(started, job), "more");
    },
    status: undefined,
    budget: { queries: 4, reads: 113, writes: 114 },
  },
  {
    group: BACKGROUND,
    name: "a job's step: the last round of a copy of 1,001 files, which makes the site",
    // Worst of a last round: the whole copy is listed twice, once for what it lacks and once to make it a site, each in two pages.
    arrange: async (stage) => {
      const { job } = await begunCopy(stage, ROUNDS_TO_WHOLE);

      return step(async (started) => `${await roundStep(started, job)}, ${(await copyStates()).join()}`, "done, finished");
    },
    status: undefined,
    budget: { queries: 6, reads: 0, writes: 4 },
  },
  {
    group: BACKGROUND,
    name: "a job's step: a round whose source lost a file, which gives the copy up",
    // Worst of a round that ends the copy: the source lacks the last file of the round alone, so every other file is copied first; then the copy's files are listed and removed, and the problem is noted.
    arrange: async (stage) => {
      const { job } = await begunCopy(stage);
      const listed = await BINDINGS.SITES.list({ prefix: `${siteFolder(1)}/v1/` });
      const last = listed.objects[2 * COPIED_A_ROUND - 1];
      if (last === undefined) throw new Error("the row's source holds too few files");

      await BINDINGS.SITES.delete(last.key);

      return step(async (started) => `${await roundStep(started, job)}, ${(await copyStates()).join()}`, "done, abandoned");
    },
    status: undefined,
    budget: { queries: 5, reads: 113, writes: 114, deletes: 1 },
  },
  {
    group: BACKGROUND,
    name: "a job's step: giving up a copy whose round failed five times",
    // The step after the last retry: the copy's files, 113 of them, are listed and removed, and the problem is noted.
    arrange: async (stage) => {
      const { job } = await begunCopy(stage);

      return step(async (started) => {
        await giveUpStep(started, job, new Error("the bucket is away"));

        return (await copyStates()).join();
      }, "abandoned");
    },
    status: undefined,
    budget: { queries: 4, reads: 0, writes: 1, deletes: 1 },
  },
  {
    group: BACKGROUND,
    name: "scheduled run: a copy whose job ended without giving it up is removed and noted",
    // What a run adds for a copy nobody finished, over 25 hours after it began: the upload given up, its 113 files listed and removed, its record removed, and the problem noted.
    arrange: async (stage) => {
      await begunCopy(stage);
      stage.w.clock.now += 24 * HOUR_MS;
      // The day's first run, which also asks for the newest version, is not the measured one.
      await sweep(unmeasured(stage).worker, stage.w);
      stage.w.clock.now += 2 * HOUR_MS;

      return async (measured) => {
        await sweep(measured.worker, measured.w, measured.bindings);
        const left = (await copyStates()).join();
        if (left !== "") throw new Error(`the row's run left the copy ${left}`);

        return undefined;
      };
    },
    status: undefined,
    budget: { queries: 11, reads: 0, writes: 1, deletes: 1 },
  },
];
