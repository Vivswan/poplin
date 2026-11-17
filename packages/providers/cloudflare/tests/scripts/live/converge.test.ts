// The script that makes the test install match the commit runs against a fake Cloudflare account in memory, through the product's own commands, and the workflow is read beside it.
// A run that stopped before it made anything once ended green with an empty log, and a run that deployed by a way of its own proved nothing of the way a person installs.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LIVE_CAPS } from "../../../scripts/live/caps";
import { answerOf, awaitNewDeployment, confirmAndCap, convergeInstall, type World } from "../../../scripts/live/converge";
import { type Found, openRun } from "../../../scripts/live/util";
import { withFake } from "../../shared/install/support/fake-cloudflare";
import { ACCOUNT as INSTALL_ACCOUNT, type Account, TOKEN } from "../../shared/install/support/fake-install";
import { type Asked, page, refusal, reply } from "../../shared/install/support/replies";
import { COMMIT, COMMIT_MODULE, freshAccount, harnessOf } from "../../live/support/harness-world";
import { openSqlInstall } from "../../live/support/sql-install";
import { catchStep } from "../../live/support/step";

/** The workflow that runs the live scripts. */
const WORKFLOW = join(import.meta.dir, "..", "..", "..", "..", "..", "..", ".github", "workflows", "live-install.yml");

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

/** What stops a run on an account whose buckets the token may not list: the bucket that marks a test account is the first thing it looks for once the plans are known to be free. */
const NO_MARK_READ = "it needs the token permission Workers R2 Storage: Edit";

/** A sentence a Worker that cannot start answers. */
const REASON = "This install's database is newer than its code: update poplin.";

/** The request of the wait for a new deployment, and the one that sets the caps, as the fake install is sent them. */
const [WHOAMI, CAPS] = ["GET /api/whoami", "PATCH /api/config"];

/** Where the Worker of the fake account that holds an install is uploaded. */
const UPLOAD = `/accounts/${INSTALL_ACCOUNT}/workers/scripts/poplin`;

/** What an upload does with the Worker's bindings: it states each by its first value, or keeps every one the Worker has. */
const [STATED, KEPT] = ["every binding stated", "every binding kept"];

/** The upload of an install made anew, and of one that stands. */
const [FIRST_UPLOAD, UPDATE_UPLOAD] = [`${STATED}, this commit's module`, `${KEPT}, this commit's module`];

/** The warning of a run whose command made the upload key. */
const FRESH_KEY = "::warning::The checks of settled-upload-key are skipped: the install needs an upload key older than two and a half minutes (this run made the key, or could not read it, and the bucket refuses a new one for about two minutes).";

/** What a run that was through says last. */
const ANSWERS = "The test install answers.";

/** What both kinds tell first of an account on the free plans. */
const PLANS = "Account plans: free (0 subscriptions: 0 at a price of 0, 0 ended)";

/** What the wait tells after an install that was made anew, and after one that was mended. */
const [TWELVE, ONCE] = ["New deployment: answered the run's token 12 times in a row over 33 seconds", "New deployment: answered the run's token"];

/** What a run says once `poplin install` read the release back: after the settings change that ends an install it made, and after the upload and the repair of one it mended. */
const [READ_MADE, READ_MENDED] = [`Release: read as ${COMMIT} after the install wrote its settings`, `Release: read as ${COMMIT} after the upload and the repair`];

/** The lines of `poplin install` on an account that holds an install, which the command says beside its value: the address with the account's own name hidden. */
const ALREADY = [
  `This account already holds poplin ${COMMIT}, at https://poplin.[hidden], and it is as it should be. nothing was changed.`,
  "The way on: npx poplin login --server https://poplin.[hidden]",
  "  to check it   npx poplin doctor",
  "  to mend it    npx poplin doctor --repair",
  "  to update it  npx poplin update",
  "  to remove it  npx poplin uninstall cloudflare",
];

/** The login, the variables, and the keys, which both kinds make alike. */
const SHARED_MADE = [
  "Access application: made",
  "Access policy: made",
  "Access open paths: made",
  "Access open paths: made",
  "Worker variable: made",
  "Worker variable: made",
  "Worker variable: made",
  "Worker variable: made",
  "Key: made",
  "Upload key: made",
  "Worker logs: left",
];

/** The same pieces as a repair that changes nothing tells them. */
const SHARED_LEFT = ["Access application: left", "Access policy: left", "Access open paths: left", "Access open paths: left", "Worker variable: left", "Key: left", "Upload key: left", "Worker logs: left"];

/** What a run tells of an account it made the install on from nothing. */
const FROM_NONE = "Install: none found, so poplin install ran";

/** The Worker's own pieces of a new install. */
const OWN_MADE = [FROM_NONE, "R2 bucket: made", "D1 database: made", "Worker: made", "Sweep trigger: made", "Worker address: made"];

/** What each kind tells of its account, of an install it made, of one it mended, and of one it removed. `bots` is what a new install does to the zone's bot switches, the one thing a removal leaves as it is set. */
const TOLD = {
  domain: {
    found: "Zone: found",
    made: (bots: string) => [
      ...OWN_MADE,
      "Public word: left",
      "DNS record: made",
      "DNS record: made",
      "Worker route: made",
      "Worker route: made",
      "Worker route: made",
      ...SHARED_MADE,
      "Redirect rule: made",
      "WAF rule: made",
      "WAF rule: made",
      "Rate rule: made",
      `Bot settings: ${bots}`,
      "Budget alert: made",
      "Certificate alert: made",
      "Workflow: made",
    ],
    mended: [
      "Worker: left",
      "Public word: left",
      "DNS record: left",
      "DNS record: left",
      "Worker route: left",
      "Worker route: left",
      "Worker route: left",
      ...SHARED_LEFT,
      "Redirect rule: left",
      "WAF rule: left",
      "WAF rule: left",
      "Rate rule: left",
      "Bot settings: left",
      "D1 database: left",
      "Budget alert: left",
      "Certificate alert: left",
      "Workflow: left",
    ],
    removed: [
      "Worker route: removed",
      "DNS record: removed",
      "Redirect rule: removed",
      "Redirect ruleset: removed",
      "WAF rule: removed",
      "WAF ruleset: removed",
      "Rate rule: removed",
      "Rate ruleset: removed",
      "Access application: removed",
      "Access policy: removed",
      "Budget alert: removed",
      "Certificate alert: removed",
      "Key: removed",
      "Upload key: removed",
      "Workflow: removed",
      "Worker: removed",
    ],
    stays: ["Bot settings: stays", "Account token: stays"],
  },
  "account address": {
    found: "Free address: found",
    made: () => [...OWN_MADE, "Forwarder: made", "Forwarder: made", ...SHARED_MADE, "Budget alert: made", "Workflow: made"],
    mended: ["Worker: left", "Forwarder: left", "Forwarder: left", ...SHARED_LEFT, "D1 database: left", "Budget alert: left", "Workflow: left"],
    removed: ["Forwarder: removed", "Access application: removed", "Access policy: removed", "Budget alert: removed", "Key: removed", "Upload key: removed", "Workflow: removed", "Worker: removed"],
    stays: ["Account token: stays"],
  },
} as const;

/** The calls Cloudflare refuses a token that carries the needed permissions and none of the optional ones. */
const REFUSED_WITHOUT_THE_OPTIONAL = [
  "GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint",
  "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint",
  "GET /zones/zone-1/bot_management",
  `GET /accounts/${INSTALL_ACCOUNT}/alerting/v3/policies`,
];

/** What a run tells the suite of an object that was left out. */
function leftOut(object: string): string {
  return `the ${object}, which was left out: the token lacks its optional permission, or the account holds it in another form`;
}

/** Who answers one request of a wait: the new deployment, the one before, or nobody. */
type From = "new" | "old" | "none";

/** One wait: whether the run stranded the build before, who answers the request of each number, and what the wait comes to with the requests it sent. */
type Wait = readonly [what: string, strandsOlder: boolean, from: (nth: number) => From, ended: unknown, requests: number];

/** What a wait that never got its answers says. */
const NEVER = "the install did not answer the run's token within 180 seconds";

/** Every wait, on a clock that moves three seconds a pause. */
const WAITS: readonly Wait[] = [
  ["a run that left the build before able to answer is confirmed by one answer", false, () => "new", { answers: 1, overMs: 0, others: 0 }, 1],
  ["the same run, met by two answers that are no 200, waits them out", false, (nth) => (nth < 2 ? "old" : "new"), { answers: 1, overMs: 0, others: 2 }, 3],
  ["after an install made anew, the new deployment answers twelve times in a row over 33 seconds", true, () => "new", { answers: 12, overMs: 33_000, others: 0 }, 12],
  ["after an install made anew, four answers of the deployment before come first and are counted", true, (nth) => (nth < 4 ? "old" : "new"), { answers: 12, overMs: 33_000, others: 4 }, 16],
  ["an answer of the deployment before in the middle of the row starts the row over", true, (nth) => (nth === 5 ? "old" : "new"), { answers: 12, overMs: 33_000, others: 1 }, 18],
  ["a request nobody answers starts the row over as a 503 does", true, (nth) => (nth === 11 ? "none" : "new"), { answers: 12, overMs: 33_000, others: 1 }, 24],
  ["a deployment before that never stops answering fails the wait at three minutes", true, () => "old", { kind: "failed", what: `${NEVER} (needed in a row: 12; not a 200: 61; last status: 503)` }, 61],
  [
    "one answer in ten from the deployment before never lets a row of twelve end, and fails the wait",
    true,
    (nth) => (nth % 10 === 9 ? "old" : "new"),
    { kind: "failed", what: `${NEVER} (needed in a row: 12; not a 200: 6; last status: 200)` },
    61,
  ],
  ["an install nobody answers from fails the wait with status 0", true, () => "none", { kind: "failed", what: `${NEVER} (needed in a row: 12; not a 200: 61; last status: 0)` }, 61],
];

/** What the fake account of a run that stops early holds, and which lists its token may read. A list that is absent is refused. */
interface FakeAccount {
  readonly subdomain?: string;
  readonly zones?: readonly (Omit<typeof ZONE, "plan"> & { readonly plan: { readonly name: string; readonly price?: number } })[];
  readonly subscriptions?: readonly Record<string, unknown>[];
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

/** Every account a run stops early on, with a domain. */
const CASES: readonly Case[] = [
  ["a token that may not read the zones stops the run with the permission it needs", {}, [], "it needs the token permission Zone: Read"],
  [
    "an account with no zone stops the run with what it needs",
    { zones: [] },
    [],
    "it needs exactly one zone in the account, or the zone's name in CLOUDFLARE_ZONE_NAME",
  ],
  ["a run that stops at its look for the marking bucket has told of the zone and the plans it could not read before it", { zones: [ZONE] }, ["Zone: found", NOT_READ, NOT_READ_WARNING], NO_MARK_READ],
  [
    "the list of an account on the free plans goes on: the storage is named as a paid plan at a price of 0, the login stands at 0 a month, and the Workers plan is not listed",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO] },
    ["Zone: found", "Account plans: free (2 subscriptions: 2 at a price of 0, 0 ended)"],
    NO_MARK_READ,
  ],
  [
    "an ended subscription with a price is no cost, and is counted apart",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO, { price: 5, state: "Cancelled", rate_plan: { id: "a_paid_plan" } }] },
    ["Zone: found", "Account plans: free (3 subscriptions: 2 at a price of 0, 1 ended)"],
    NO_MARK_READ,
  ],
  [
    "the same list with one subscription at a price stops the run before anything is read of an install, whatever its name",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO, { ...R2_AT_ZERO, price: 5, rate_plan: { id: "a_plan_of_later", public_name: "Free Extras" } }] },
    ["Zone: found"],
    "the account's subscriptions are not all at a price of 0: 1 of 3 (a_plan_of_later at 5), and the test account stays on the free plans",
  ],
  [
    "a subscription with no price is not known to be free, and stops the run",
    { zones: [ZONE], subscriptions: [R2_AT_ZERO, { state: "Paid", rate_plan: { id: "storage" } }] },
    ["Zone: found"],
    "the account's subscriptions are not all at a price of 0: 1 of 2 (storage at no price), and the test account stays on the free plans",
  ],
  ["a zone on a paid plan stops the run before anything is read of an install", { zones: [{ ...ZONE, plan: { name: "Pro Website" } }], subscriptions: [] }, ["Zone: found"], "the zone is on the pro plan, not the Free plan"],
  [
    "a zone whose plan has a price and a name the run does not know stops the run all the same",
    { zones: [{ ...ZONE, plan: { name: "A Plan Of Later", price: 20 } }], subscriptions: [] },
    ["Zone: found"],
    "the zone's plan has a price, so it is not the Free plan",
  ],
];

/** A world no run of these reaches: each stops before its first command. */
const UNREACHED: World = {
  release: { version: COMMIT, pin: { bundle: "0".repeat(64), schema: 1 }, pages: new Map() },
  ends: { reach: { fetch: () => Promise.reject(new Error("a command ran")), now: () => 0, sleep: async () => undefined }, sleep: async () => undefined },
  fetch: () => Promise.reject(new Error("the install was asked")),
};

/** Answer for the fake account: its zones, its subscriptions, and a refusal of anything its token may not read. */
function answer(account: FakeAccount, asked: Asked): Response {
  const { pathname } = new URL(asked.path, "http://localhost");
  if (pathname === "/zones" && account.zones !== undefined) return page(asked, account.zones);

  if (pathname === `/zones/${ZONE.id}` && account.zones?.[0] !== undefined) return reply(account.zones[0]);

  if (pathname === `/accounts/${ACCOUNT}/workers/subdomain` && account.subdomain !== undefined) return reply({ subdomain: account.subdomain });

  if (pathname === `/accounts/${ACCOUNT}/subscriptions` && account.subscriptions !== undefined) return reply(account.subscriptions);

  return refusal(403, 10000, "Authentication error");
}

/** Run the script on a fake account it stops early on, with the log, the step summary, and the step's outputs caught. */
async function converge(account: FakeAccount, kind: Found["kind"] = "domain"): Promise<Told> {
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-selftest-"));
  const env = {
    CLOUDFLARE_API_TOKEN: "a-made-up-token",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    GITHUB_STEP_SUMMARY: join(folder.path, "summary.md"),
    GITHUB_OUTPUT: join(folder.path, "output"),
    POPLIN_LIVE_INSTALL: kind,
  };
  using step = catchStep(env.GITHUB_OUTPUT);
  let code = 0;

  await withFake(
    (asked) => answer(account, asked),
    async (connection) => {
      code = await convergeInstall({ ...openRun(env), connection }, env, UNREACHED);
    },
  );

  const lines = step.lines.filter((line) => !line.startsWith("::add-mask::"));

  return { code, lines, summary: readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), outputs: Object.keys(step.outputs()) };
}

/** What one run on the account in memory came to: its exit code, its lines, what it told the suite is lacking, and each upload of the Worker it sent: whether it kept the Worker's bindings, and whose module it carried. */
interface Ran {
  readonly code: number;
  readonly lines: readonly string[];
  readonly missing: Readonly<Record<string, string>>;
  readonly uploads: readonly string[];
}

/** A test account in memory, and what runs the script on it once more: of a kind of install, and asked to start over or not. */
async function standingOn(account: Account, kind: Found["kind"]): Promise<{ readonly account: Account; readonly again: (startOver?: boolean) => Promise<Ran>; readonly printed: () => string; readonly settings: () => Promise<unknown> }> {
  const harness = await harnessOf(account, kind);
  const said: string[] = [];

  return {
    account,
    printed: () => said.join("\n"),
    settings: harness.settings,
    again: async (startOver = false) => {
      using _step = catchStep();
      harness.lines.length = 0;
      const before = harness.asked.length;
      const code = await convergeInstall(harness.run, { POPLIN_LIVE_INSTALL: kind, POPLIN_LIVE_START_OVER: String(startOver) }, harness.world);
      const puts = harness.asked.slice(before).filter((asked) => asked.method === "PUT" && (asked.path === UPLOAD || asked.path.startsWith(`${UPLOAD}?`)));
      const uploads = puts.map((asked) => `${asked.path.includes("bindings_inherit=strict") ? KEPT : STATED}, ${(asked.body as Record<string, unknown>)["worker.js"] === COMMIT_MODULE ? "this commit's module" : "another module"}`);
      said.push(...harness.lines, JSON.stringify(harness.outputs));

      return { code, lines: [...harness.lines], missing: JSON.parse(harness.outputs.missing ?? "{}") as Record<string, string>, uploads };
    },
  };
}

/** What the deployment before answers once its database is gone: the Worker's own 503. */
function oldAnswer(): Response {
  return new Response("Something went wrong. Try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Run one wait against a fake install of a kind, with a clock that moves in a pause alone, and answer what it came to with every request it sent. */
async function wait(kind: "domain" | "account address", strandsOlder: boolean, from: (nth: number) => From, token?: string): Promise<{ readonly ended: unknown; readonly sent: readonly string[] }> {
  const install = await openSqlInstall(kind);
  const known = token ?? (await install.addToken("the wait"));
  const sent: string[] = [];
  let now = 0;

  const ended = await awaitNewDeployment({
    server: install.server,
    token: known,
    strandsOlder,
    now: () => now,
    pause: async (ms) => {
      now += ms;
    },
    fetch: async (input, init) => {
      const who = from(sent.length);
      sent.push(`${init.method ?? "GET"} ${input} keepalive=${String(init.keepalive)} redirect=${String(init.redirect)}`);
      if (who === "none") throw new Error("no answer");

      return who === "old" ? oldAnswer() : install.fetch(input, init);
    },
  });

  return { ended, sent };
}

/**
 * Run the wait for the new deployment and the caps against a fake install whose database the run reaches through a fake of Cloudflare's API.
 *
 * @param stale - how many of the first requests the deployment before answers, with its own 503
 * @returns what stopped the run, the lines it told, each request the install was sent, and the rows of tokens it was left with
 */
async function confirm(kind: Found["kind"], strandsOlder: boolean, stale: number): Promise<{ readonly stopped: unknown; readonly lines: string[]; readonly sent: string[]; readonly tokens: number }> {
  using _step = catchStep();
  const install = await openSqlInstall(kind);
  const told = { stopped: undefined as unknown, lines: [] as string[], sent: [] as string[], tokens: 0 };
  let now = 0;

  await withFake(
    async (asked) => {
      const { sql, params } = asked.body as { readonly sql: string; readonly params: readonly string[] };

      return reply([{ results: await install.sql(sql, params), success: true, meta: {} }]);
    },
    async (connection) => {
      const run = { ...openRun({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection, say: (line: string) => void told.lines.push(line) };
      const reached = {
        server: install.server,
        now: () => now,
        pause: async (ms: number) => {
          now += ms;
        },
        fetch: async (input: string, init: RequestInit) => {
          told.sent.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);

          return told.sent.length <= stale ? oldAnswer() : install.fetch(input, init);
        },
      };
      told.stopped = await confirmAndCap(run, reached, { id: "2".repeat(32), strandsOlder }, { pieces: [], missing: {} });
    },
  );
  told.tokens = (await install.sql("SELECT id FROM tokens")).length;

  return told;
}

/** Every string a parsed document holds, at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (typeof value !== "object" || value === null) return [];

  return Object.values(value).flatMap(stringsOf);
}

describe.each(["domain", "account address"] as const)("the test install of an account, on its %s, made, mended, and removed by the product's own commands on a fake account in memory", (kind) => {
  const told = TOLD[kind];

  // Drift: a run that put the Worker in place by a way of its own would prove nothing of `poplin install`; and one that made what stands again would leave a new key and a new login on every push.
  test("the first run makes the install with poplin install and this commit's build in its first upload; the next finds it, puts the build in place by the upload of an update, and mends it with nothing made twice", async () => {
    const standing = await standingOn(freshAccount(), kind);
    const [first, second] = [await standing.again(), await standing.again()];

    expect(first).toEqual({ code: 0, lines: [told.found, PLANS, ...told.made("changed"), READ_MADE, TWELVE, "Storage and file caps: set", FRESH_KEY, ANSWERS], missing: { "settled-upload-key": expect.any(String) }, uploads: [FIRST_UPLOAD] });
    expect(second).toEqual({
      code: 0,
      lines: [
        told.found,
        PLANS,
        ...ALREADY,
        `Install: found, runs ${COMMIT}`,
        `Worker's code: this commit's build, by the upload of an update (${COMMIT} -> ${COMMIT})`,
        ...told.mended,
        "Sweep: has not asked for a newer version yet",
        READ_MENDED,
        ONCE,
        "Storage and file caps: set",
        ANSWERS,
      ],
      missing: {},
      uploads: [UPDATE_UPLOAD],
    });
    expect({ versions: standing.account.versions.map((version) => (version.annotations as { readonly "workers/tag": string })["workers/tag"]), keys: standing.account.tokens.length }).toEqual({ versions: [COMMIT, COMMIT, COMMIT], keys: 2 });
    // The caps reached the install's own database, through its real API and a token whose row the run stored there.
    expect(await standing.settings()).toMatchObject(LIVE_CAPS);
  });

  // Drift: a release read from the tag of the latest version reads as none after the first change of the Worker's settings, on Cloudflare alone: no fake said so for months.
  // The run reads it back with the product's own command, so a release that is no longer read turns the test install red on the next push.
  test.each([
    ["makes", 0, "Install: none found, so poplin install ran", "the install wrote its settings"],
    ["mends", 1, "Worker's code: ", "the upload and the repair"],
  ] as const)("a run that %s an install whose Worker then states no release stops, and says after what the release was not read", async (_what, earlier, line, after) => {
    using _step = catchStep();
    const harness = await harnessOf(freshAccount(), kind);
    const env = { POPLIN_LIVE_INSTALL: kind, POPLIN_LIVE_START_OVER: "false" };
    for (let run = 0; run < earlier; run += 1) await convergeInstall(harness.run, env, harness.world);
    harness.lines.length = 0;
    const say = (said: string): void => {
      harness.run.say(said);
      if (said.startsWith(line)) harness.account.bindings = harness.account.bindings.filter((binding) => binding.name !== "RELEASE");
    };
    const code = await convergeInstall({ ...harness.run, say }, env, harness.world);

    const ended = harness.lines.filter((said) => said.includes("Release") || said.includes("did not read"));

    expect([code, ended]).toEqual([1, [`::error::The test install could not be made ready: poplin install did not read the install as this commit's build after ${after}.`]]);
  });

  // Drift: a start-over that removed by a list of its own would pass while `poplin uninstall` left a piece behind; and one that took the marking bucket would leave an account no later run may remove anything on.
  test("a run asked to start over removes the install with poplin uninstall, the files and the database too, then makes it anew: the marking bucket stays, and the wait asks twelve answers in a row", async () => {
    const standing = await standingOn(freshAccount(), kind);
    await standing.again();
    const over = await standing.again(true);
    const removal = [...told.removed, "Sites' files: removed (0 in it)", "Database: removed (0 in it)", ...told.stays, `Removal: ${told.removed.length + 2} kinds in 0 seconds`];

    expect(over.lines).toEqual([told.found, PLANS, "Start over: asked for", ...removal, ...told.made("left"), READ_MADE, TWELVE, "Storage and file caps: set", FRESH_KEY, ANSWERS]);
    expect({ code: over.code, uploads: over.uploads, buckets: standing.account.buckets.map((bucket) => bucket.name) }).toEqual({ code: 0, uploads: [FIRST_UPLOAD], buckets: ["poplin-live-sites", "poplin-sites"] });
  });

  // Drift: the Worker of the next commit refused the database of the last one, and every address answered 503; and an install bound to a bucket of another name would be mended forever and never be the product's.
  test.each([
    [
      "a Worker bound to another bucket than the product's",
      async (account: Account) => {
        account.bindings = account.bindings.map((binding) => (binding.name === "SITES" ? { ...binding, bucket_name: "poplin-live-sites" } : binding));
        account.buckets = account.buckets.filter((bucket) => bucket.name !== "poplin-sites");
      },
      [] as readonly string[],
    ],
    ["a database that held schema step 1 as another build applied it", async (account: Account) => void (await account.store?.call("UPDATE schema_steps SET fingerprint = 'of another build'", [])), ["Sites' files: removed (0 in it)"]],
    [
      "a Worker of an install that was never finished",
      async (account: Account) => {
        account.bindings = account.bindings.filter((binding) => binding.name !== "ZONE");
      },
      ["Sites' files: removed (0 in it)"],
    ],
  ])("an install another build made, with %s, is started over by the run itself, with nobody asking", async (what, drift, files) => {
    const standing = await standingOn(freshAccount(), kind);
    await standing.again();
    await drift(standing.account);
    const over = await standing.again();
    const removal = [...told.removed, ...files, "Database: removed (0 in it)", ...told.stays, `Removal: ${told.removed.length + files.length + 1} kinds in 0 seconds`];

    expect(over).toEqual({
      code: 0,
      lines: [told.found, PLANS, `Start over: another build made it: ${what}`, ...removal, ...told.made("left"), READ_MADE, TWELVE, "Storage and file caps: set", FRESH_KEY, ANSWERS],
      missing: { "settled-upload-key": expect.any(String) },
      uploads: [FIRST_UPLOAD],
    });
  });

  // Drift: the commands are the product's whole install, repair, and uninstall. On the account of a person they would change their install, or take it and every site with it.
  test.each([
    ["a usual run", false],
    ["a run asked to start over", true],
  ])("on an account without the bucket that marks a test account, %s stops before its first command, and nothing is changed", async (_what, startOver) => {
    const harness = await harnessOf(freshAccount({ buckets: [] }), kind);
    using _step = catchStep();
    const code = await convergeInstall(harness.run, { POPLIN_LIVE_INSTALL: kind, POPLIN_LIVE_START_OVER: String(startOver) }, harness.world);

    expect({ code, lines: harness.lines, changes: harness.asked.filter((asked) => asked.method !== "GET").length }).toEqual({
      code: 1,
      lines: [told.found, PLANS, "::error::The test install could not be made ready: the account holds no bucket that marks a test account, so nothing in it is changed."],
      changes: 0,
    });
  });

  // Drift: the repair reads the Worker a second after the run's own upload, when Cloudflare's settings can still list it with no binding. A run that took that read as final stops on its own install as on a stranger's Worker.
  test("a Worker whose settings list no binding right after the run's upload is read again by the repair, and the run goes on to its end", async () => {
    const standing = await standingOn(freshAccount(), kind);
    await standing.again();
    standing.account.trailing = { from: "upload", answers: [{ bindings: [] }] };
    const ran = await standing.again();

    expect([ran.code, ran.uploads, ran.lines.at(-1), standing.account.trailing.answers]).toEqual([0, [UPDATE_UPLOAD], ANSWERS, []]);
  });

  // Drift: an install that lost a piece answers nowhere until it is mended. A run that waited for its answer before the repair would time out and never reach the repair that puts the piece back.
  test("an install that lost a piece nothing answers without is mended before the run waits for its answer", async () => {
    const standing = await standingOn(freshAccount(), kind);
    await standing.again();
    Object.assign(standing.account, kind === "domain" ? { routes: [] } : { workers: [] });
    const ran = await standing.again();
    const back = kind === "domain" ? ["Worker route: made", "Worker route: made", "Worker route: made"] : ["Forwarder: made", "Forwarder: made"];

    expect([ran.code, ran.lines.filter((line) => line.endsWith(": made")), ran.lines.at(-1)]).toEqual([0, back, ANSWERS]);
  });

  // Drift: Access is a switch only a person flips. A run that called its rows a failure would turn the test install red on an account where everything else answers.
  test("on an account whose Access is off, the login's rows are a lack the suite skips for, on the run that makes the install and on the one that mends it", async () => {
    const standing = await standingOn(freshAccount({ accessOff: true }), kind);
    const [first, second] = [await standing.again(), await standing.again()];
    const lacking = ["Access application", "Access policy", "Access open paths", "Worker variable"].map((object) => `${object}: stopped: needs Access switched on for the account`);

    expect([first.code, second.code, first.missing.access, second.missing]).toEqual([0, 0, "Access switched on for the account", { access: "Access switched on for the account" }]);
    expect([first.lines.filter((line) => line.includes("stopped")), second.lines.filter((line) => line.includes("stopped"))]).toEqual([lacking, lacking]);
  });

  // Drift: an install answers without its Workflow, which only a copy too large for one request needs. A run that called that a failure would stop the test install for a part every other check passes without.
  test("a Workflow Cloudflare does not make is a lack the suite skips for, whatever the refusal, and never a failure of the run", async () => {
    const standing = await standingOn(freshAccount({ refuse: `PUT /accounts/${INSTALL_ACCOUNT}/workflows/poplin-jobs`, refuseAs: { status: 500, code: 10001 } }), kind);
    const ran = await standing.again();

    expect([ran.code, ran.missing.jobs, ran.lines.filter((line) => line.startsWith("Workflow"))]).toEqual([
      0,
      "the Worker's Workflow, which Cloudflare did not make",
      ["Workflow: failed (refused with status 500): needs the Worker's Workflow, which Cloudflare did not make"],
    ]);
  });

  // Drift: a run that went on after a piece nothing answers without would wait five minutes for an install that cannot answer, and say only that it did not.
  test("a piece nothing answers without, which the token may not make, stops the run at that piece with the permission it needs", async () => {
    const standing = await standingOn(freshAccount({ refuse: `POST /accounts/${INSTALL_ACCOUNT}/d1/database` }), kind);
    const ran = await standing.again();

    expect(ran).toEqual({
      code: 1,
      lines: [told.found, PLANS, FROM_NONE, "R2 bucket: made", "D1 database: stopped: needs the token permission D1: Edit", "::error::The test install could not be made ready: it needs the token permission D1: Edit."],
      missing: {},
      uploads: [],
    });
  });

  // Drift: every line of a run is public. The commands word their rows with the install's addresses, and one of them printed whole would name the test account.
  test("no line and no output of a run holds the token, the account, or a name of the place the install answers at", async () => {
    const standing = await standingOn(freshAccount({ accessOff: true }), kind);
    await standing.again();
    await standing.again();
    await standing.again(true);
    const printed = standing.printed();

    expect([TOKEN, INSTALL_ACCOUNT, "example.com", "example.workers.dev"].filter((name) => printed.includes(name))).toEqual([]);
  });
});

describe("the rows of an install with a domain, made by a token with none of the optional permissions", () => {
  // Drift: the install page says the needed permissions are enough, so a run that called the optional rows a failure would turn the test install red for the very token a reader is told to make.
  test("every optional object is left out, which is a lack the suite skips for and never a failure, and every object an install answers with is made", async () => {
    const ran = await (await standingOn(freshAccount({ refuse: REFUSED_WITHOUT_THE_OPTIONAL }), "domain")).again();
    const out = ["Redirect rule", "WAF rule", "Rate rule", "Bot settings", "Budget alert", "Certificate alert"];

    expect({ code: ran.code, out: ran.lines.filter((line) => line.includes(": left out: ")), made: ran.lines.filter((line) => line.endsWith(": made")).length }).toEqual({
      code: 0,
      out: out.map((object) => `${object}: left out: needs ${leftOut(object)}`),
      made: 21,
    });
    expect(ran.missing).toEqual({
      "settled-upload-key": expect.any(String),
      "https-redirect": leftOut("Redirect rule"),
      "guard-rules": leftOut("WAF rule"),
      "rate-rule": leftOut("Rate rule"),
      "bot-block": leftOut("Bot settings"),
    });
  });
});

describe.each(["domain", "account address"] as const)("the wait for a run's new deployment, against a local fake install on its %s", (kind) => {
  // Drift: the checks once began right after a deploy that followed a remade database, and requests of theirs reached the build before, which answered 503.
  test.each(WAITS)("%s", async (_what, strandsOlder, from, ended, requests) => {
    const told = await wait(kind, strandsOlder, from);

    expect({ ended: told.ended, requests: told.sent.length }).toEqual({ ended, requests });
  });

  // Drift: a request on a connection the edge kept open reaches the instance the last one reached, so a row of them would say nothing of any other.
  test("every request asks the API who the token is, on a connection of its own, and follows no redirect", async () => {
    const { sent } = await wait(kind, true, () => "new");
    const server = kind === "domain" ? "https://poplin.example.com" : "https://poplin.example.workers.dev";

    expect([...new Set(sent)]).toEqual([`GET ${server}/api/whoami keepalive=false redirect=manual`]);
  });

  // Drift: an answer to a token the database does not hold would pass for the new deployment's, and so would the build before on a database that never took the row.
  test("a token whose row the install's database does not hold is never answered 200, so the wait fails", async () => {
    const { ended } = await wait(kind, false, () => "new", "poplin_live_a-token-of-no-row");

    expect(ended).toEqual({ kind: "failed", what: `${NEVER} (needed in a row: 1; not a 200: 61; last status: 401)` });
  });
});

describe.each(["domain", "account address"] as const)("the end of the script, on a fake install on its %s: the wait for the new deployment, then the caps", (kind) => {
  // Drift: a wait that every run paid in full would add half a minute and a dozen requests to each push; one that an install made anew did not pay would start the checks on the deployment before.
  test.each([
    ["a run that left the build before able to answer costs one request, then the caps", false, 0, ["New deployment: answered the run's token", "Storage and file caps: set"], [WHOAMI, CAPS]],
    [
      "a run after an install made anew waits out the deployment before, then twelve answers in a row, then the caps",
      true,
      3,
      ["New deployment: answered the run's token 12 times in a row over 33 seconds, after 3 requests that got no 200", "Storage and file caps: set"],
      [...Array.from({ length: 15 }, () => WHOAMI), CAPS],
    ],
  ])("%s, and the run's token is removed", async (_what, strandsOlder, stale, lines, sent) => {
    expect(await confirm(kind, strandsOlder, stale)).toEqual({ stopped: undefined, lines, sent, tokens: 0 });
  });

  // Drift: caps set through the deployment before would be written to a database that is gone, and the step would end green with the checks about to meet the same instances.
  test("a deployment before that never stops answering stops the run in a plain line: no caps are asked for, and the token is removed", async () => {
    const told = await confirm(kind, true, Number.POSITIVE_INFINITY);
    const what = "the install did not answer the run's token within 180 seconds (needed in a row: 12; not a 200: 61; last status: 503)";

    expect({ ...told, sent: [...new Set(told.sent)] }).toEqual({ stopped: { kind: "failed", what }, lines: [], sent: [WHOAMI], tokens: 0 });
  });
});

describe("the script that makes the test install, on a fake account it stops early on", () => {
  test.each(CASES)("%s", async (_what, account, lines, reason) => {
    const told = await converge(account);
    const sentence = `The test install could not be made ready: ${reason}.`;

    expect({ code: told.code, lines: told.lines }).toEqual({ code: 1, lines: [...lines, `::error::${sentence}`] });
    expect(told.summary).toContain(`**${sentence}**`);
    // The zone's name is hidden before anything is written.
    expect(told.summary).not.toContain(ZONE.name);
  });

  test("every output of the step the workflow reads is one the script writes, even on a run that stopped", async () => {
    const told = await converge({ zones: [ZONE] });
    const written = told.outputs.map((output) => `${CONVERGE_STEP}.${output}`);
    const workflow: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8"));
    const read = stringsOf(workflow)
      .flatMap((text) => [...text.matchAll(OUTPUT_READ)].map((match) => `${match[1]}.${match[2]}`))
      .filter((name) => name.startsWith(`${CONVERGE_STEP}.`));

    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((name) => !written.includes(name))).toEqual([]);
  });

  // Drift: the second test account holds no zone. A run that still looked for one, or read a zone's plan, would stop there before it made anything, on that account alone.
  test.each<[string, FakeAccount, string[], string]>([
    ["a token that may not read the account's free address stops the run with the permission it needs", {}, [], "it needs the token permission Workers Scripts: Edit"],
    [
      "an account without a domain is found by its free address, its plans are read with no zone, and its name is in no line",
      { subdomain: "example", subscriptions: [R2_AT_ZERO, LOGIN_AT_ZERO] },
      ["Free address: found", "Account plans: free (2 subscriptions: 2 at a price of 0, 0 ended)"],
      NO_MARK_READ,
    ],
    [
      "a free address no hostname can be made under stops the run with the rule it breaks",
      { subdomain: "an_account" },
      [],
      "the account's free address is none an install can use (bad-account)",
    ],
  ])("without a domain: %s", async (_what, account, lines, reason) => {
    const told = await converge(account, "account address");
    const sentence = `The test install could not be made ready: ${reason}.`;

    expect({ code: told.code, lines: told.lines }).toEqual({ code: 1, lines: [...lines, `::error::${sentence}`] });
    expect(told.summary).toContain(`**${sentence}**`);
  });

  test("a run told a kind of install that is none stops before it asks Cloudflare anything", async () => {
    const told = await converge({ zones: [ZONE] }, "no kind" as Found["kind"]);

    expect(told.lines).toEqual(["::error::The test install could not be made ready: POPLIN_LIVE_INSTALL names no kind of install."]);
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
