// The start-over of the test install runs against a local fake account that holds an install and things of its owner's own.
// A removal that took a record, a route, a rule, or an application poplin did not make would show on the real zone alone, after it was gone.

import { describe, expect, test } from "bun:test";

import { startOver } from "../../../scripts/live/start-over";
import { BUCKET, openRun } from "../../../scripts/live/util";
import { createDomainPlug } from "../../../src/with-domain/zone-plug";
import { withFake } from "../../shared/install/support/fake-cloudflare";
import { ACCOUNT, type Account, answer as answerInstall, emptyAccount, TOKEN } from "../../shared/install/support/fake-install";
import { LAYOUT } from "../../shared/install/support/layouts";
import { type Asked, page, refusal, reply } from "../../shared/install/support/replies";
import type { Login } from "../../../../../core/src/auth/logins";
import { catchStep } from "../../live/support/step";

/** What the owner of the zone keeps there beside the install: none of it carries a mark of poplin's. */
const THEIRS = {
  record: { id: "their-record", name: "mail.example.com", type: "A", content: "192.0.2.1", proxied: false, comment: "the owner's own" },
  route: { id: "their-route", pattern: "shop.example.com/*", script: "shop" },
  rule: { id: "their-rule", ref: "their_rule", description: "the owner's own", expression: "true", action: "block", enabled: true },
  application: { id: "their-application", name: "wiki", type: "self_hosted", domain: "wiki.example.com" },
  policy: { id: "their-policy", name: "wiki readers", decision: "allow" },
  alert: { id: "their-alert", name: "my budget", alert_type: "billing_budget_alert", enabled: true },
  token: { id: "their-token", name: "deploys", status: "active" },
  workflow: { name: "poplin-jobs-of-the-shop", script_name: "shop", class_name: "Orders" },
};

/** The phase the owner's rule sits in, beside two of poplin's. */
const THEIR_PHASE = "http_request_firewall_custom";

/** What a run that removed everything tells, kind by kind. */
const REMOVED = [
  "Worker routes: removed 3",
  "DNS records: removed 2",
  "Rules: removed 4",
  "Access applications and policies: removed 4",
  "Workflow: removed 1",
  "Worker: removed 1",
  "Database: removed 1",
  "Bucket objects: removed 2",
  "Budget alert: removed 1",
  "Keys: removed 2",
];

/** What a run on an account that holds nothing of poplin's tells. */
const NOTHING = REMOVED.map((line) => line.replace(/\d+$/, "0"));

/** The fake account, with what the install's fake lacks. */
interface World {
  /** What the fake of an install's account holds. */
  readonly account: Account;

  /** Whether the account holds the test install's bucket. */
  bucket: boolean;

  /** The keys of the bucket's objects. */
  objects: string[];

  /** Whether the Worker's script is there. */
  worker: boolean;

  /** The Workers beside the install's own, on an account without a domain: its forwarders, and somebody's Worker of a forwarder's name. */
  beside?: { readonly id: string; readonly tags: readonly string[] }[];

  /** The Workers removed so far, in the order removed. */
  gone?: string[];

  /** How many calls asked for a zone, or for something of one. */
  zoneCalls?: number;
}

/** What one run left: its exit code, and its lines without the masks. */
interface Told {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Answer for the Workers of an account without a domain: its free address, the list of its Workers, and the removal of one beside the install's own; `undefined` for any other call. */
function answerBeside(world: World, asked: Asked, path: string): Response | undefined {
  const scripts = `/accounts/${ACCOUNT}/workers/scripts`;
  if (path === `/accounts/${ACCOUNT}/workers/subdomain`) return reply({ subdomain: "example" });

  if (path === scripts) return page(asked, [...(world.worker ? [{ id: "poplin", tags: [] }] : []), ...(world.beside ?? [])]);

  const name = path.startsWith(`${scripts}/`) && asked.method === "DELETE" ? path.slice(scripts.length + 1) : undefined;
  if (name === undefined) return undefined;

  world.gone?.push(name);
  if (name === "poplin") return undefined;

  world.beside = world.beside?.filter((worker) => worker.id !== name);

  return new Response(null, { status: 204 });
}

/** Answer what the install's fake does not hold, and hand the rest to it. */
function answer(world: World, asked: Asked): Response {
  const [path = ""] = asked.path.split("?");
  const bucket = `/accounts/${ACCOUNT}/r2/buckets`;
  if (path.startsWith("/zones")) world.zoneCalls = (world.zoneCalls ?? 0) + 1;

  const beside = answerBeside(world, asked, path);
  if (beside !== undefined) return beside;

  if (path === `/accounts/${ACCOUNT}/subscriptions`) return refusal(403, 10000, "Authentication error");

  if (path === bucket) return reply({ buckets: world.bucket ? [{ name: BUCKET }] : [] });

  if (path === `${bucket}/${BUCKET}/objects`) return reply(world.objects.map((key) => ({ key })));

  if (path.startsWith(`${bucket}/${BUCKET}/objects/`)) {
    world.objects = world.objects.filter((key) => key !== decodeURIComponent(path.slice(`${bucket}/${BUCKET}/objects/`.length)));

    return reply({});
  }

  if (path === `/accounts/${ACCOUNT}/workers/scripts/poplin` && asked.method === "DELETE") {
    const held = world.worker;
    world.worker = false;

    return held ? new Response(null, { status: 204 }) : refusal(404, 10007, "This Worker does not exist on your account.");
  }

  return answerInstall(world.account, asked);
}

/** A fake account that holds a whole install, made by the Domain tab's own repair, and the owner's own things beside it. */
async function installed(): Promise<World> {
  const world: World = { account: emptyAccount(), bucket: true, objects: ["sites/a/1/index.html", "sites/a/1/style.css"], worker: true };

  await withFake(
    (asked) => answer(world, asked),
    async (connection) => {
      const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl });
      const repaired = await plug.repair(TOKEN, async () => ({ logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" }));
      if (!repaired.ok) throw new Error(`the fake install was not made: ${repaired.refusal}`);
    },
  );

  world.account.records.push({ ...THEIRS.record });
  world.account.routes.push({ ...THEIRS.route });
  world.account.rulesets[THEIR_PHASE]?.rules.push({ ...THEIRS.rule });
  world.account.applications.push({ ...THEIRS.application });
  world.account.policies.push({ ...THEIRS.policy });
  world.account.alerts.push({ ...THEIRS.alert });
  world.account.tokens.push({ ...THEIRS.token });
  world.account.workflows.push({ ...THEIRS.workflow });

  return world;
}

/** Run the start-over on the fake account, as the run of an account with a domain, or of one without. */
async function run(world: World, asking = "true", kind = "domain"): Promise<Told> {
  using step = catchStep();
  let told: Told = { code: 0, lines: [] };

  await withFake(
    (asked) => answer(world, asked),
    async (connection) => {
      const env = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, POPLIN_LIVE_START_OVER: asking, POPLIN_LIVE_INSTALL: kind };
      const code = await startOver({ ...openRun(env), connection: { ...connection, key: TOKEN } }, env);
      told = { code, lines: step.lines.filter((line) => !line.startsWith("::add-mask::")) };
    },
  );

  return told;
}

/** What the account still holds: everything of the kinds a start-over removes. */
function heldBy(world: World): unknown {
  const { records, routes, rulesets, applications, policies, databases, alerts, tokens, workflows } = world.account;
  const rules = Object.values(rulesets).flatMap((ruleset) => ruleset?.rules ?? []);

  return { records, routes, rules, applications: applications.map(({ aud: _aud, ...application }) => application), policies, databases, alerts, tokens, workflows, objects: world.objects, worker: world.worker };
}

/** What stays after a start-over: the owner's own things, and nothing of poplin's. */
const ONLY_THEIRS = {
  records: [THEIRS.record],
  routes: [THEIRS.route],
  rules: [THEIRS.rule],
  applications: [THEIRS.application],
  policies: [THEIRS.policy],
  databases: [],
  alerts: [THEIRS.alert],
  tokens: [THEIRS.token],
  workflows: [THEIRS.workflow],
  objects: [],
  worker: false,
};

describe("the start-over of the test install, against a local fake account", () => {
  test("everything poplin made is removed and counted, the owner's record, route, rule, application, policy, alert, and Workflow stay, and a second run removes nothing", async () => {
    const world = await installed();
    const first = await run(world);
    const held = heldBy(world);
    const second = await run(world);

    expect([first, held]).toEqual([{ code: 0, lines: REMOVED }, ONLY_THEIRS]);
    expect([second, heldBy(world)]).toEqual([{ code: 0, lines: NOTHING }, ONLY_THEIRS]);
  });

  // Drift: an account names each Workflow once, so the name alone does not say whose it is. A start-over that went by the name would take the jobs of another Worker of the account.
  test("a Workflow of the Worker's name that runs another Worker's code stays", async () => {
    const world = await installed();
    const theirs = { name: "poplin-jobs", script_name: "shop", class_name: "Orders" };
    world.account.workflows = [theirs];
    const told = await run(world);

    expect([told.code, told.lines.filter((line) => line.startsWith("Workflow")), world.account.workflows]).toEqual([0, ["Workflow: removed 0"], [theirs]]);
  });

  // Drift: a run that stopped half-way and could not be run again would leave the test account with half an install nothing can remove.
  test("a run that stops at the database has removed what came before it, and the next run removes the rest", async () => {
    const world = await installed();
    world.account.refuse = `DELETE /accounts/${ACCOUNT}/d1/database/${world.account.databases[0]?.uuid}`;
    const stopped = await run(world);
    const left = world.account.databases.length;
    world.account.refuse = [];
    const finished = await run(world);

    expect([stopped.code, stopped.lines, left]).toEqual([1, [...REMOVED.slice(0, 6), "Database: removed 0", "::error::The test install was not started over: it needs the token permission D1: Edit."], 1]);
    expect([finished, heldBy(world)]).toEqual([{ code: 0, lines: [...NOTHING.slice(0, 6), ...REMOVED.slice(6)] }, ONLY_THEIRS]);
  });

  // Drift: the token of the install page's link has no right to the zone's rules, so a start-over that stopped there could never run with it; one that went on in silence would call the install gone.
  test("a kind the token may not reach is left with a warning that names what it needs, and the run goes on", async () => {
    const world = await installed();
    world.account.refuse = "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint";
    const needs = "the token permission for the rules of the zone";
    const told = await run(world);
    const rules = Object.values(world.account.rulesets).flatMap((ruleset) => ruleset?.rules ?? []);

    expect(told).toEqual({
      code: 0,
      lines: [...REMOVED.slice(0, 2), `Rules: removed 1, the rest left: needs ${needs}`, `::warning::The start-over left the Rules it could not reach: it needs ${needs}.`, ...REMOVED.slice(3)],
    });
    expect([rules.map((rule) => rule.ref), heldBy(world)]).toEqual([["poplin_outside_pages", "poplin_bots", "their_rule", "poplin_rate"], { ...ONLY_THEIRS, rules }]);
  });

  // Drift: the same token shape reaches a person's own install, where a start-over would take the whole install away.
  test.each([
    ["an account without the test install's bucket", (world: World) => Object.assign(world, { bucket: false }), "true", "the account holds no bucket of the test install, so nothing in it is removed"],
    ["a run nobody ticked the box for", (world: World) => world, "false", "nobody asked for it: POPLIN_LIVE_START_OVER is not true"],
  ])("%s is refused, and nothing is removed", async (_what, change, asking, reason) => {
    const world = change(await installed());
    const before = structuredClone(heldBy(world));
    const told = await run(world, asking);

    expect([told.code, told.lines, heldBy(world)]).toEqual([1, [`::error::The test install was not started over: ${reason}.`], before]);
  });

  // Drift: a forwarder is bound to the one Worker, and the second test account holds no zone. A start-over that removed the Worker first, or asked for a zone, would stop on that account alone.
  // Cloudflare keeps a Workflow whose Worker was deleted: one left on that account would stay there for good.
  test("without a domain, the forwarder and the Workflow go before the Worker, a Worker of a forwarder's name without poplin's tag stays, and no kind of a zone is asked for", async () => {
    const theirs = { id: "poplin-private", tags: ["somebody-s-own"] };
    const world: World = { account: emptyAccount(), bucket: true, objects: ["sites/a/1/index.html"], worker: true, beside: [{ id: "poplin-sites", tags: ["poplin-forwarder"] }, theirs], gone: [] };
    world.account.databases.push({ uuid: "database-1", name: "poplin" });
    world.account.tokens.push({ id: "key-0", name: "poplin kept key", status: "active" }, { ...THEIRS.token });
    world.account.workflows.push({ name: "poplin-jobs", script_name: "poplin", class_name: "PoplinJobs" }, { ...THEIRS.workflow });
    const first = await run(world, "true", "account address");
    const left = [[...(world.gone ?? [])], world.beside, world.account.tokens, world.account.databases, world.objects, world.zoneCalls, world.account.workflows];
    const second = await run(world, "true", "account address");

    expect(first).toEqual({
      code: 0,
      lines: ["Forwarders: removed 1", "Access applications and policies: removed 0", "Workflow: removed 1", "Worker: removed 1", "Database: removed 1", "Bucket objects: removed 1", "Keys: removed 1"],
    });
    expect(left).toEqual([["poplin-sites", "poplin"], [theirs], [THEIRS.token], [], [], undefined, [THEIRS.workflow]]);
    expect(second.lines).toEqual(first.lines.map((line) => line.replace(/\d+$/, "0")));
  });
});
