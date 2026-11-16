// The script that makes the test install runs against a local fake of the Cloudflare API, and the workflow is read beside it.
// A run that stopped before it made anything once ended green with an empty log.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { DomainRow, DomainSettings } from "../../packages/app/src/console/domain/records";
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

/** The storage's subscription as Cloudflare lists it before anything is billed: a paid plan by its name, at a price of 0. */
const R2_AT_ZERO = { price: 0, currency: "USD", state: "Paid", rate_plan: { id: "r2_paid", public_name: "R2 Paid" } };

/** The login's subscription on its free plan. */
const LOGIN_AT_ZERO = { price: 0, currency: "USD", frequency: "monthly", state: "Paid", rate_plan: { id: "teams_free", public_name: "Teams Free Base" } };

/** What a run tells of an account whose token may not read the subscriptions. */
const NOT_READ = "Account plans: not read: needs the token permission Billing: Read";

/** The warning that goes with it. */
const NOT_READ_WARNING = "::warning::The account's plans were not read, so nothing checked that they are free: the run needs the token permission Billing: Read.";

/** The package wrangler is installed in. */
const CLOUDFLARE = join(import.meta.dir, "..", "..", "packages", "cloudflare");

/** The repository's own configuration of the Worker. */
const OWN_CONFIG = join(CLOUDFLARE, "..", "..", "wrangler.jsonc");

/** A Worker small enough to bundle in a moment, as source. */
const SOURCE = { "worker.ts": 'export default { fetch: (): Response => new Response("ok") };\n' };

/** The same Worker as a file that is built already and names the map beside it. */
const BUILT = { "worker.js": 'export default { fetch: () => new Response("ok") };\n//# sourceMappingURL=worker.js.map\n' };

/** The map of that built file. */
const BUILT_MAP = { "worker.js.map": '{"version":3,"sources":["../src/worker.ts"],"sourcesContent":[""],"mappings":"AAAA","names":[]}' };

/** How an upload starts the part that is the Worker's map: its name, then its type, which is not that of a module or of a file for visitors. */
const MAP_PART = 'Content-Disposition: form-data; name="worker.js.map"; filename="worker.js.map"\r\nContent-Type: application/source-map\r\n';

/** An upload that carries the Worker's map, names no folder of the machine, and publishes no file to visitors. */
const WITH_MAP: Upload = { made: true, map: true, folder: false, assets: false };

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

/** What wrangler made of a configuration: whether it made an upload, and whether the upload holds the map as a part of its own, the name of the folder the Worker was read from, and files for visitors. */
interface Upload {
  readonly made: boolean;
  readonly map: boolean;
  readonly folder: boolean;
  readonly assets: boolean;
}

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
    "the list of an account on the free plans goes on: the storage is named as a paid plan at a price of 0, the login stands at 0 a month, and the Workers plan is not listed",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO], buckets: ["poplin-live-sites"] },
    ["Zone: found", "Account plans: free (2 subscriptions: 2 at a price of 0, 0 ended)", "R2 bucket: present"],
    "it needs the token permission D1: Edit",
  ],
  [
    "an ended subscription with a price is no cost, and is counted apart",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO, { price: 5, state: "Cancelled", rate_plan: { id: "a_paid_plan" } }], buckets: ["poplin-live-sites"] },
    ["Zone: found", "Account plans: free (3 subscriptions: 2 at a price of 0, 1 ended)", "R2 bucket: present"],
    "it needs the token permission D1: Edit",
  ],
  [
    "the same list with one subscription at a price stops the run before anything is made, whatever its name",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO, { ...R2_AT_ZERO, price: 5, rate_plan: { id: "a_plan_of_later", public_name: "Free Extras" } }], buckets: ["poplin-live-sites"] },
    ["Zone: found"],
    "the account's subscriptions are not all at a price of 0: 1 of 3 (a_plan_of_later at 5), and the test account stays on the free plans",
  ],
  [
    "a subscription with no price is not known to be free, and stops the run",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, { state: "Paid", rate_plan: { id: "storage" } }], buckets: ["poplin-live-sites"] },
    ["Zone: found"],
    "the account's subscriptions are not all at a price of 0: 1 of 2 (storage at no price), and the test account stays on the free plans",
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

/** The test install's configuration, for a fake account. */
function installConfig(): Promise<Record<string, unknown>> {
  return workerConfig({ accountId: ACCOUNT }, { layout: LAYOUT }, { databaseId: "2".repeat(32), access: { team_domain: "team.example.com", audience: "3".repeat(64) }, login: "owner@example.com" });
}

/**
 * Have wrangler make the upload of a configuration and write it to a file, with nothing sent: no token is handed over.
 * The Worker is the given files in a scratch folder, in place of the real entry, and the step that builds the dashboard is left out.
 */
async function uploadOf(config: Record<string, unknown>, files: Readonly<Record<string, string>>): Promise<Upload> {
  // The scratch folder is named as the disk holds it: through a link, wrangler writes the way from one name of it to the other into the map.
  using folder = mkdtempDisposableSync(join(realpathSync(tmpdir()), "poplin-live-upload-"));
  const [main = ""] = Object.keys(files);
  const body = join(folder.path, "upload.form");

  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder.path, name), text);

  writeFileSync(join(folder.path, "wrangler.json"), JSON.stringify({ ...config, $schema: undefined, main: join(folder.path, main), build: undefined }));
  const wrangler = Bun.spawn([join(CLOUDFLARE, "node_modules", ".bin", "wrangler"), "deploy", "--dry-run", "--config", join(folder.path, "wrangler.json"), "--outfile", body], {
    cwd: CLOUDFLARE,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", CI: "true" },
    stdout: "ignore",
    stderr: "ignore",
  });
  const made = (await wrangler.exited) === 0;
  if (!made) return { made, map: false, folder: false, assets: false };

  const text = readFileSync(body, "utf8");

  return { made, map: text.includes(MAP_PART), folder: text.includes(basename(folder.path)), assets: text.includes('"assets"') };
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
    const config = await installConfig();
    const read = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

    expect({ asItIs: read.no_bundle, minify: "minify" in read }).toEqual({ asItIs: true, minify: false });
  });
});

describe("the upload wrangler makes, with nothing sent", () => {
  // Drift: an error in Cloudflare's log names a source file and its line only while every upload carries the map. A map that went missing would be left out with no word, on a deploy against the real account alone.
  // The map is a part of the upload with a type of its own, beside the Worker and not among files for visitors: the upload names none. A map that named the scratch folder would name any machine it is built on.
  test.each([
    ["a deploy of the repository's own configuration bundles the Worker and sends its map", async () => Bun.JSONC.parse(readFileSync(OWN_CONFIG, "utf8")) as Record<string, unknown>, SOURCE, WITH_MAP],
    ["the test install's upload of a built file sends the map beside it", installConfig, { ...BUILT, ...BUILT_MAP }, WITH_MAP],
    ["the test install's upload of a built file whose map is missing stops", installConfig, BUILT, { made: false, map: false, folder: false, assets: false }],
  ])(
    "%s",
    async (_what, config, files, upload) => {
      expect(await uploadOf(await config(), files)).toEqual(upload);
    },
    60_000,
  );
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

/** The calls Cloudflare refuses a token made from the link on the setup page, which carries nine rights and none of the four optional ones. */
const REFUSED_WITH_THE_LINK_RIGHTS = [
  "GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint",
  "GET /zones/zone-1/bot_management",
  `GET /accounts/${INSTALL_ACCOUNT}/alerting/v3/policies`,
];

describe("the zone's repair with the nine rights of the token link alone, against a local fake account", () => {
  // Drift: the install page says the link's token is enough, so a run that called its rows a failure would turn the test install red for the very token a reader is told to make.
  test("every row the repair did not settle is a lack the suite skips for, never a failure, and every object an install answers with is made", async () => {
    const account = { ...emptyAccount(), refuse: REFUSED_WITH_THE_LINK_RIGHTS };
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
      ["Budget alert", "optional", "the token permission for the Budget alert"],
    ]);
    expect([...new Set(rows.filter((row) => row.state === "created").map((row) => row.object))]).toEqual([
      "DNS record",
      "Worker route",
      "Access application",
      "Access policy",
      "Worker variable",
      "Key",
      "D1 database",
    ]);
  });

  // Drift: the run holds no key of the install, so it reads the key's state at Cloudflare. A run that made a key on every push would leave the test install a new Worker version and a new token each time.
  test("the key: the first run makes it, a later run finds it present and makes none, and a token that may not make one is a lack the suite skips for", async () => {
    const [account, lacking] = [emptyAccount(), { ...emptyAccount(), refuse: `GET /accounts/${INSTALL_ACCOUNT}/tokens/permission_groups` }];
    const settings = async (): Promise<DomainSettings> => ({ logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" });
    const keyOf = async (baseUrl: string | undefined): Promise<(string | undefined)[]> => {
      const reading = await createDomainPlug({ accountId: INSTALL_ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl }).repair(TOKEN, settings);

      return (reading.ok ? reading.rows : []).filter((row) => row.object === "Key").flatMap((row) => [row.state, needOf(row)]);
    };

    await withFake(
      (asked) => answerInstall(account, asked),
      async (connection) => {
        expect([await keyOf(connection.baseUrl), await keyOf(connection.baseUrl), account.tokens.length]).toEqual([["created", undefined], ["present", undefined], 1]);
      },
    );
    await withFake(
      (asked) => answerInstall(lacking, asked),
      async (connection) => {
        expect(await keyOf(connection.baseUrl)).toEqual(["failed", "the token permission for the Key"]);
      },
    );
  });
});
