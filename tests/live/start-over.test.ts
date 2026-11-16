// The start-over of the test install runs against a local fake account that holds an install and things of its owner's own.
// A removal that took a record, a route, a rule, or an application poplin did not make would show on the real zone alone, after it was gone.

import { describe, expect, test } from "bun:test";

import { startOver } from "../../packages/cloudflare/scripts/live/start-over";
import { BUCKET, openRun } from "../../packages/cloudflare/scripts/live/util";
import { createDomainPlug } from "../../packages/cloudflare/src/zone/zone-plug";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { ACCOUNT, type Account, answer as answerInstall, emptyAccount, TOKEN } from "../../packages/cloudflare/tests/zone/support/fake-install";
import { LAYOUT } from "../../packages/cloudflare/tests/zone/support/layouts";
import { type Asked, refusal, reply } from "../../packages/cloudflare/tests/zone/support/replies";
import type { Login } from "../../packages/core/src/auth/logins";
import { catchStep } from "./support/step";

/** What the owner of the zone keeps there beside the install: none of it carries a mark of poplin's. */
const THEIRS = {
  record: { id: "their-record", name: "mail.example.com", type: "A", content: "192.0.2.1", proxied: false, comment: "the owner's own" },
  route: { id: "their-route", pattern: "shop.example.com/*", script: "shop" },
  rule: { id: "their-rule", ref: "their_rule", description: "the owner's own", expression: "true", action: "block", enabled: true },
  application: { id: "their-application", name: "wiki", type: "self_hosted", domain: "wiki.example.com" },
  policy: { id: "their-policy", name: "wiki readers", decision: "allow" },
  alert: { id: "their-alert", name: "my budget", alert_type: "billing_budget_alert", enabled: true },
  token: { id: "their-token", name: "deploys", status: "active" },
};

/** The phase the owner's rule sits in, beside two of poplin's. */
const THEIR_PHASE = "http_request_firewall_custom";

/** What a run that removed everything tells, kind by kind. */
const REMOVED = [
  "Worker routes: removed 3",
  "DNS records: removed 2",
  "Rules: removed 4",
  "Access application and policy: removed 2",
  "Worker: removed 1",
  "Database: removed 1",
  "Bucket objects: removed 2",
  "Budget alert: removed 1",
  "Key: removed 1",
];

/** What a run on an account that holds nothing of poplin's tells. */
const NOTHING = REMOVED.map((line) => line.replace(/\d+$/, "0"));

/** The fake account, with what the install's fake lacks: the test install's bucket and its objects, and whether the Worker's script is there. */
interface World {
  readonly account: Account;
  bucket: boolean;
  objects: string[];
  worker: boolean;
}

/** What one run left: its exit code, and its lines without the masks. */
interface Told {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Answer what the install's fake does not hold, and hand the rest to it. */
function answer(world: World, asked: Asked): Response {
  const [path = ""] = asked.path.split("?");
  const bucket = `/accounts/${ACCOUNT}/r2/buckets`;
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

  return world;
}

/** Run the start-over on the fake account. */
async function run(world: World, asking = "true"): Promise<Told> {
  using step = catchStep();
  let told: Told = { code: 0, lines: [] };

  await withFake(
    (asked) => answer(world, asked),
    async (connection) => {
      const env = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, POPLIN_LIVE_START_OVER: asking };
      const code = await startOver({ ...openRun(env), connection: { ...connection, key: TOKEN } }, env);
      told = { code, lines: step.lines.filter((line) => !line.startsWith("::add-mask::")) };
    },
  );

  return told;
}

/** What the account still holds: everything of the kinds a start-over removes. */
function heldBy(world: World): unknown {
  const { records, routes, rulesets, applications, policies, databases, alerts, tokens } = world.account;
  const rules = Object.values(rulesets).flatMap((ruleset) => ruleset?.rules ?? []);

  return { records, routes, rules, applications: applications.map(({ aud: _aud, ...application }) => application), policies, databases, alerts, tokens, objects: world.objects, worker: world.worker };
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
  objects: [],
  worker: false,
};

describe("the start-over of the test install, against a local fake account", () => {
  test("everything poplin made is removed and counted, the owner's record, route, rule, application, policy, and alert stay, and a second run removes nothing", async () => {
    const world = await installed();
    const first = await run(world);
    const held = heldBy(world);
    const second = await run(world);

    expect([first, held]).toEqual([{ code: 0, lines: REMOVED }, ONLY_THEIRS]);
    expect([second, heldBy(world)]).toEqual([{ code: 0, lines: NOTHING }, ONLY_THEIRS]);
  });

  // Drift: a run that stopped half-way and could not be run again would leave the test account with half an install nothing can remove.
  test("a run that stops at the database has removed what came before it, and the next run removes the rest", async () => {
    const world = await installed();
    world.account.refuse = `DELETE /accounts/${ACCOUNT}/d1/database/${world.account.databases[0]?.uuid}`;
    const stopped = await run(world);
    const left = world.account.databases.length;
    world.account.refuse = [];
    const finished = await run(world);

    expect([stopped.code, stopped.lines, left]).toEqual([1, [...REMOVED.slice(0, 5), "Database: removed 0", "::error::The test install was not started over: it needs the token permission D1: Edit."], 1]);
    expect([finished, heldBy(world)]).toEqual([{ code: 0, lines: [...NOTHING.slice(0, 5), ...REMOVED.slice(5)] }, ONLY_THEIRS]);
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
});
