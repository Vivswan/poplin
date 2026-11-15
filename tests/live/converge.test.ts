// The script that makes the test install runs against a local fake of the Cloudflare API, and the workflow is read beside it.
// A run that stopped before it made anything once ended green with an empty log.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DomainRow } from "../../packages/app/src/console/domain/records";
import type { Login } from "../../packages/core/src/auth/logins";
import { answerOf, convergeInstall, needOf, workerConfig } from "../../packages/cloudflare/scripts/live/converge";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { createDomainPlug } from "../../packages/cloudflare/src/zone/zone-plug";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { ACCOUNT as INSTALL_ACCOUNT, answer as answerInstall, emptyAccount, TOKEN } from "../../packages/cloudflare/tests/zone/support/fake-install";
import { LAYOUT } from "../../packages/cloudflare/tests/zone/support/layouts";
import { type Asked, page, refusal, reply } from "../../packages/cloudflare/tests/zone/support/replies";
import { catchStep } from "./support/step";

/** The workflow that runs the live scripts. */
const WORKFLOW = join(import.meta.dir, "..", "..", ".github", "workflows", "live-checks.yml");

/** A step's output as a workflow expression names it: the step's id, then the output's name. */
const OUTPUT_READ = /steps\.([\w-]+)\.outputs\.([\w-]+)/g;

/** The id of the workflow step that runs the script. */
const CONVERGE_STEP = "converge";

/** The account the fake holds. */
const ACCOUNT = "0".repeat(32);

/** The zone of a fake account that has one. */
const ZONE = { id: "1".repeat(32), name: "example.com", account: { id: ACCOUNT }, plan: { name: "Free Website" } };

/** What a run tells of an account whose token may not read the subscriptions. */
const NOT_READ = "Account plans: not read: needs the token permission Billing: Read";

/** The warning that goes with it. */
const NOT_READ_WARNING = "::warning::The account's plans were not read, so nothing checked that they are free: the run needs the token permission Billing: Read.";

/** A sentence a Worker that cannot start answers. */
const REASON = "This install's database is newer than its code: update poplin.";

/** What the fake account holds, and which lists its token may read. A list that is absent is refused. */
interface FakeAccount {
  readonly zones?: readonly (Omit<typeof ZONE, "plan"> & { readonly plan: { readonly name: string; readonly price?: number } })[];
  readonly subscriptions?: readonly Record<string, unknown>[];
  readonly buckets?: readonly string[];
}

/** One fake account, and what a run on it tells: the lines of the log in order, and the reason the summary and the error line give. */
type Case = readonly [what: string, account: FakeAccount, lines: readonly string[], reason: string];

/** What one run of the script left behind. */
interface Told {
  readonly code: number;
  readonly lines: string[];
  readonly summary: string;
  readonly outputs: string[];
}

const CASES: readonly Case[] = [
  ["a token that may not read the zones stops the run with the permission it needs", {}, [], "it needs the token permission Zone: Read"],
  [
    "an account with no zone stops the run with what it needs",
    { zones: [] },
    [],
    "it needs exactly one zone in the account, or the zone's name in CLOUDFLARE_ZONE_NAME",
  ],
  [
    "a run that stops at the database has told of the zone, the plans it could not read, and the bucket before it",
    { zones: [ZONE], buckets: ["poplin-live-sites"] },
    ["Zone: found", NOT_READ, NOT_READ_WARNING, "R2 bucket: present"],
    "it needs the token permission D1: Edit",
  ],
  [
    "an account whose subscriptions all cost nothing goes on, and an ended one with a price is no cost",
    { zones: [ZONE], subscriptions: [{ price: 0, rate_plan: { id: "free" } }, { rate_plan: { id: "storage" } }, { price: 5, state: "Cancelled" }], buckets: ["poplin-live-sites"] },
    ["Zone: found", "Account plans: free (3 subscriptions)", "R2 bucket: present"],
    "it needs the token permission D1: Edit",
  ],
  [
    "an account that pays for a subscription stops the run before anything is made",
    { zones: [ZONE], subscriptions: [{ price: 0, rate_plan: { id: "free" } }, { price: 5, state: "Paid", rate_plan: { id: "a_paid_plan" } }], buckets: ["poplin-live-sites"] },
    ["Zone: found"],
    "the account pays for 1 of its 2 subscriptions (a_paid_plan), and the test account stays on the free plans",
  ],
  [
    "a zone on a paid plan stops the run before anything is made",
    { zones: [{ ...ZONE, plan: { name: "Pro Website" } }], subscriptions: [], buckets: ["poplin-live-sites"] },
    ["Zone: found"],
    "the zone is on the pro plan, not the Free plan",
  ],
  [
    "a zone whose plan has a price and a name the run does not know stops the run all the same",
    { zones: [{ ...ZONE, plan: { name: "A Plan Of Later", price: 20 } }], subscriptions: [], buckets: ["poplin-live-sites"] },
    ["Zone: found"],
    "the zone's plan has a price, so it is not the Free plan",
  ],
];

/** Answer for the fake account: its zones, its buckets, and a refusal of anything its token may not read. */
function answer(account: FakeAccount, asked: Asked): Response {
  const { pathname } = new URL(asked.path, "http://localhost");
  if (pathname === "/zones" && account.zones !== undefined) return page(asked, account.zones);

  if (pathname === `/zones/${ZONE.id}` && account.zones?.[0] !== undefined) return reply(account.zones[0]);

  if (pathname === `/accounts/${ACCOUNT}/subscriptions` && account.subscriptions !== undefined) return reply(account.subscriptions);

  if (pathname === `/accounts/${ACCOUNT}/r2/buckets` && asked.method === "GET" && account.buckets !== undefined) {
    return reply({ buckets: account.buckets.map((name) => ({ name })) });
  }

  return refusal(403, 10000, "Authentication error");
}

/** Run the script on a fake account, with the log, the step summary, and the step's outputs caught. */
async function converge(account: FakeAccount): Promise<Told> {
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-selftest-"));
  const env = {
    CLOUDFLARE_API_TOKEN: "a-made-up-token",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    GITHUB_STEP_SUMMARY: join(folder.path, "summary.md"),
    GITHUB_OUTPUT: join(folder.path, "output"),
  };
  using step = catchStep(env.GITHUB_OUTPUT);
  let code = 0;

  await withFake(
    (asked) => answer(account, asked),
    async (connection) => {
      code = await convergeInstall({ ...openRun(env), connection }, env);
    },
  );

  const lines = step.lines.filter((line) => !line.startsWith("::add-mask::"));

  return { code, lines, summary: readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), outputs: Object.keys(step.outputs()) };
}

/** Every string a parsed document holds, at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (typeof value !== "object" || value === null) return [];

  return Object.values(value).flatMap(stringsOf);
}

describe("the script that makes the test install, against a local fake account", () => {
  test.each(CASES)("%s", async (_what, account, lines, reason) => {
    const told = await converge(account);
    const sentence = `The test install could not be made ready: ${reason}.`;

    expect({ code: told.code, lines: told.lines }).toEqual({ code: 1, lines: [...lines, `::error::${sentence}`] });
    expect(told.summary).toContain(`**${sentence}**`);
    // The zone's name is hidden before anything is written.
    expect(told.summary).not.toContain(ZONE.name);
  });

  test("every output of the step the workflow reads is one the script writes, even on a run that stopped", async () => {
    const told = await converge({ zones: [ZONE], buckets: [] });
    const written = told.outputs.map((output) => `${CONVERGE_STEP}.${output}`);
    const workflow: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8"));
    const read = stringsOf(workflow)
      .flatMap((text) => [...text.matchAll(OUTPUT_READ)].map((match) => `${match[1]}.${match[2]}`))
      .filter((name) => name.startsWith(`${CONVERGE_STEP}.`));

    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((name) => !written.includes(name))).toEqual([]);
  });
});

describe("the configuration the built bundle is uploaded by", () => {
  // Drift: the repository's own configuration says how wrangler bundles the Worker, and the upload hands wrangler a file that is bundled already. Wrangler warns of `minify` beside `no_bundle`, on a deploy that runs against the real account alone.
  test("as wrangler reads it, the file is uploaded as it is and nothing says to minify it", async () => {
    const config = await workerConfig({ accountId: ACCOUNT }, { layout: LAYOUT }, { databaseId: "2".repeat(32), access: { team_domain: "team.example.com", audience: "3".repeat(64) }, login: "owner@example.com" });
    const read = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

    expect({ asItIs: read.no_bundle, minify: "minify" in read }).toEqual({ asItIs: true, minify: false });
  });
});

describe("what a failed wait for the install repeats of its answer", () => {
  // Drift: a wait that told the status alone ended as "last status 503" after five minutes, while the Worker's own sentence said why it could not start.
  test.each([
    ["the first line of the Worker's reason", new Response(`${REASON}\nMore.\n`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }), `503: ${REASON}`],
    ["a long line, cut", new Response("x".repeat(500), { status: 500, headers: { "Content-Type": "text/plain" } }), `500: ${"x".repeat(200)}`],
    ["the status alone of a page that is no plain text", new Response("<title>example.com</title>", { status: 502, headers: { "Content-Type": "text/html" } }), "502"],
    ["the status alone of an answer with no body", new Response(null, { status: 401 }), "401"],
    ["the status alone of a plain text that breaks off", new Response(new ReadableStream({ start: (stream) => stream.error(new Error("cut")) }), { status: 503, headers: { "Content-Type": "text/plain" } }), "503"],
    ["0 for no answer", undefined, "0"],
  ])("%s", async (_what, response, told) => {
    const asking = response === undefined ? Promise.reject(new Error("the name does not resolve")) : Promise.resolve(response);

    expect((await answerOf(asking)).told).toBe(told);
  });
});

/** The calls Cloudflare refuses a token made from the link on the setup page, which carries eight rights and none of the three optional ones. */
const REFUSED_WITH_EIGHT_RIGHTS = [
  "GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint",
  "GET /zones/zone-1/bot_management",
];

describe("the zone's repair with the eight rights of the token link alone, against a local fake account", () => {
  // Drift: the install page says the link's token is enough, so a run that called its rows a failure would turn the test install red for the very token a reader is told to make.
  test("every row the repair did not settle is a lack the suite skips for, never a failure, and every object an install answers with is made", async () => {
    const account = { ...emptyAccount(), refuse: REFUSED_WITH_EIGHT_RIGHTS };
    let rows: readonly DomainRow[] = [];

    await withFake(
      (asked) => answerInstall(account, asked),
      async (connection) => {
        const plug = createDomainPlug({ accountId: INSTALL_ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl });
        const reading = await plug.repair(TOKEN, async () => ({ logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" }));
        rows = reading.ok ? reading.rows : [];
      },
    );

    const unsettled = rows.filter((row) => row.state !== "present" && row.state !== "created");

    expect(unsettled.map((row) => [row.object, row.state, needOf(row)])).toEqual([
      ["Redirect rule", "optional", "the token permission for the Redirect rule"],
      ["WAF rule", "optional", "the token permission for the WAF rule"],
      ["Rate rule", "optional", "the token permission for the Rate rule"],
      ["Bot settings", "optional", "the token permission for the Bot settings"],
    ]);
    expect([...new Set(rows.filter((row) => row.state === "created").map((row) => row.object))]).toEqual([
      "DNS record",
      "Worker route",
      "Access application",
      "Access policy",
      "Worker variable",
      "D1 database",
    ]);
  });
});
