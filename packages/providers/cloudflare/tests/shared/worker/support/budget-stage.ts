// What one row of the budget table is measured on: an install with its seeds, then one request to an instance whose every call to the database and the bucket is counted.

import type { Api } from "@poplin/app/src/api/api";
import type { Install } from "@poplin/core/src/actions/records";
import type { Job } from "@poplin/core/src/jobs/jobs";
import { hc } from "hono/client";
import type { Bindings } from "../../../../src/shared/worker/bindings";
import type { Outside } from "../../../../src/shared/worker/start";
import { INSTALL_OBJECTS } from "../../../../src/shared/install/install-objects";
import { emptyAccount, TOKEN } from "../../install/support/fake-install";
import { emptyTally, type Tally, talliedBindings } from "./call-tally";
import { ADMIN, type ApiCalls, accessHeaders, ask, BINDINGS, cloudflareOf, installOf, instance, OWNER, type Published, page, publish, send, type TestFile, tokenOf, type Worker, type World, world } from "./install";

/** How long ago the login of a row's session began: past the minutes in which a page still writes the login's Activity line. */
const LOGIN_AGE_MS = 3_600_000;

/** How far the clock moves before a measured request to an instance that has answered one: past the minute a site request trusts the settings for, so the request reads them again. */
const SETTINGS_LAPSE_MS = 61_000;

/** What a row's seeds are made with. */
export interface Stage {
  /** The clock and the team of the row. */
  readonly w: World;

  /** The install as the rule book takes it, on the plain bindings: what it does is counted nowhere. */
  readonly install: Install;

  /** What stands in for the world outside the Worker, for the instance the row is measured on. A row sets the parts its request reaches. */
  readonly outside: { cloudflare?: Outside["cloudflare"]; latest?: Outside["latest"] };

  /** The key the measured instance keeps for Cloudflare. A row sets it to measure an install that holds one; left alone, the install holds none. */
  keptKey?: string;

  /** The Workflow the measured instance is bound to. A row sets it to measure an install that has one; left alone, the install has none. */
  jobs?: Workflow<Job>;

  /** The upload key the measured instance holds, as its secret's text. A row sets it to measure an install that sends files straight to the bucket; left alone, the install holds none. */
  uploadKey?: string;
}

/** The instance a row's request is sent to, and the counted bindings every request to it carries. */
export interface Measured {
  readonly worker: Worker;
  readonly bindings: Bindings;
  readonly w: World;
}

/** What a measured step answers, as far as the table reads it; `undefined` for a scheduled run, which answers nothing. */
type Answered = { readonly status: number } | undefined;

/** The one request, or the one run, a row is measured by. */
export type Step = (measured: Measured) => Promise<Answered>;

/** The most a row may cost. */
export interface Budget {
  /** The queries to the database, a batch being one. */
  readonly queries: number;

  /** The rows the database reads, where the row's seed makes that a number worth holding. */
  readonly read?: number;

  /** The rows the database writes, where the row is there to hold that none is. */
  readonly written?: number;

  /** The reads of the bucket, which R2 bills as Class B: every get and every head. */
  readonly reads: number;

  /** The writes of the bucket, which R2 bills as Class A: every put and every listing. */
  readonly writes: number;

  /** The removals from the bucket, up to a thousand keys each, which R2 bills nothing for; none when left out. */
  readonly deletes?: number;
}

/** What a person does that a row is part of, as the printed table groups its rows. */
export type Group = "One page view of a site" | "Each dashboard screen" | "Publishing" | "CLI / agent actions" | "Background work";

/** One thing the product does, with the most it may cost. */
export interface BudgetRow {
  /** What a person does that the row is part of. */
  readonly group: Group;

  /** What the row does, as the printed table names it. */
  readonly name: string;

  /** The route the row is a budget of, as `METHOD path`; left out for what is no route of the API or the dashboard's data. */
  readonly route?: string;

  /** `new` measures the request as the first one of a new instance, which starts in it. `warm` measures it as the second of two alike, with no time between. Left out, the instance answered another request over a minute ago. */
  readonly start?: "new" | "warm";

  /** Seed the install for the worst the row can meet, and answer the step to measure. */
  readonly arrange: (stage: Stage) => Promise<Step>;

  /** The status the step answers: it proves the work was done, and not refused at the door. `undefined` for a scheduled run. */
  readonly status: number | undefined;

  /** The most the row may cost. */
  readonly budget: Budget;

  /** Why a row above a ceiling is let through for now, in one line. A row that is under every ceiling carries none. */
  readonly known?: string;

  /** The action of the guide's table "What one action costs" the row is a request of. The guide states what the rows of one action cost together. */
  readonly guide?: string;
}

/** What a row cost, and what it answered. */
interface Cost extends Tally {
  /** The status the step answered. */
  readonly status: number | undefined;

  /** The milliseconds the step took by the clock, the local database and bucket included: about what it costs, and no measure of processing time. */
  readonly ms: number;
}

/** One row with what it cost, as a test keeps it on itself for the run's report: the tests run in the Workers runtime, and the report is written outside it. */
export interface CostLine extends Tally {
  readonly group: Group;
  readonly name: string;
  readonly budget: Budget;
  readonly ms: number;
  readonly known?: string;
  readonly guide?: string;
}

declare module "vitest" {
  interface TaskMeta {
    /** The name of the row a budget test measures, kept before it does: a test that fails first still says which row it was. */
    row?: string;

    /** What the row cost. */
    cost?: CostLine;
  }
}

/** A row's stage on an empty install that has started once: its schema, its first settings, and its visitor key are there. */
async function stageOf(): Promise<Stage> {
  const w = await world();
  await ask(instance(w), `${ADMIN}/api/whoami`);

  return { w, install: await installOf(w), outside: {} };
}

/** A new admin token of the stage's install. */
export function adminToken(stage: Stage): Promise<string> {
  return tokenOf(stage.w, "admin");
}

/** Give the measured install a key, and an account that holds its guarded application, so every login can be ended there. */
export function endsLogins(stage: Stage): void {
  const account = emptyAccount();
  account.applications.push({ id: "app-1", name: INSTALL_OBJECTS.accessApplication });
  stage.outside.cloudflare = cloudflareOf(account, []);
  stage.keptKey = TOKEN;
}

/**
 * The headers Access puts on the owner's requests, for a login that began an hour ago and whose Activity line the log holds.
 * The setup page is shut from then on, and no page of that login writes or asks anything for its line.
 */
export async function sessionOf(stage: Stage): Promise<Record<string, string>> {
  const { now } = stage.w.clock;
  const began = Math.floor((now - LOGIN_AGE_MS) / 1000);
  await stage.install.database.appendAudit({ action: "login", detail: {} }, { as: "person", by: OWNER, at: now - LOGIN_AGE_MS });

  return accessHeaders(stage.w, { iat: began, nbf: began });
}

/** Publish a site through the API of an instance that is not measured. */
export async function published(stage: Stage, asked: Parameters<typeof publish>[2], files: readonly TestFile[] = [page("<h1>a page</h1>")]): Promise<Published> {
  return publish(instance(stage.w), await adminToken(stage), asked, files);
}

/** Run one statement on the plain database: a seed too large to make through the product a row at a time. */
export async function sql(text: string, ...values: readonly (string | number | null)[]): Promise<void> {
  await BINDINGS.DB.prepare(text)
    .bind(...values)
    .run();
}

/** An instance of the stage's own that no tally sees: what a seed asks the product through. */
export function unmeasured(stage: Stage): Measured {
  return { worker: instance(stage.w), bindings: BINDINGS, w: stage.w };
}

/** The API as one caller asks the measured instance. */
export function apiOf(measured: Measured, token: string | null): ApiCalls {
  const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };

  return hc<Api>(ADMIN, { headers, fetch: (input: RequestInfo | URL, init?: RequestInit) => ask(measured.worker, String(input), init, measured.bindings) }).api;
}

/** Ask the measured instance for an address. */
export function get(measured: Measured, url: string, headers: Record<string, string> = {}, method = "GET"): Promise<Response> {
  return ask(measured.worker, url, { method, headers }, measured.bindings);
}

/** Send the measured instance a change of the admin hostname as the dashboard's client sends it, under a session. */
export function post(measured: Measured, path: string, body: unknown, session: Record<string, string>): Promise<Response> {
  return send(measured.worker, `${ADMIN}${path}`, body, session, measured.bindings);
}

/** Take a step, and read its answer to the end: a streamed answer asks the database while it is read. */
async function answered(step: Step, measured: Measured): Promise<Answered> {
  const answer = await step(measured);
  if (answer instanceof Response) await answer.arrayBuffer();

  return answer;
}

/**
 * Measure one row on an install emptied before it.
 *
 * @returns every call the row's one step made, a start of the instance among them for a row measured on a new one
 */
export async function costOf(row: BudgetRow): Promise<Cost> {
  const stage = await stageOf();
  const step = await row.arrange(stage);
  const tally = emptyTally();
  const secrets = { ...(stage.keptKey === undefined ? {} : { KEPT_KEY: stage.keptKey }), ...(stage.uploadKey === undefined ? {} : { UPLOAD_KEY: stage.uploadKey }) };
  const bindings = { ...talliedBindings(tally), ...secrets, ...(stage.jobs === undefined ? {} : { JOBS: stage.jobs }) };
  const measured: Measured = { worker: instance(stage.w, stage.outside.cloudflare, stage.outside.latest), bindings, w: stage.w };

  if (row.start !== "new") {
    await get(measured, `${ADMIN}/api/whoami`);
    stage.w.clock.now += SETTINGS_LAPSE_MS;
    if (row.start === "warm") await answered(step, measured);

    Object.assign(tally, emptyTally());
  }

  const began = Date.now();
  const answer = await answered(step, measured);

  return { ...tally, status: answer?.status, ms: Date.now() - began };
}
