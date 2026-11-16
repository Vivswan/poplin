// The plug of an install without a domain against a whole account at the fake API.
// Without these the second kind of install could drift from the first unnoticed: a row of the domain's pieces on an install that has no zone, a token that proves itself by anything but the account's free address, or a key with a zone's rights.

import { expect, test } from "bun:test";
import type { DomainReading, DomainSettings } from "@poplin/app/src/console/domain/records";
import { runDone } from "../../../app/src/console/domain-answers";
import type { Login } from "@poplin/core/src/auth/logins";
import { createPathPlug, givePathKey } from "../../src/zone/path-plug";
import { withFake } from "./support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, KEY_VALUE_START, OTHER_TOKEN, TEAM, TOKEN } from "./support/fake-install";
import { ADDRESSES } from "./support/layouts";
import type { Asked } from "./support/replies";

/** The settings the install holds. */
const STORED: DomainSettings = { logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };

/** Reads them, as a plug asks once a token is proven. */
const SETTINGS = async (): Promise<DomainSettings> => STORED;

/** What every token that does not prove itself is answered. */
const REFUSED = { ok: false, refusal: "token" } as const;

/** The rights the owner set for the token of an install without a domain, in the provider's names: no right of a zone is among them. */
const RIGHTS = ["Access: Apps and Policies: Edit", "Workers Scripts: Edit", "Access: Organizations, Identity Providers, and Groups: Read", "D1: Edit", "Account API Tokens: Edit"];

/** An account whose one Worker answers under the free address and holds no value of a domain. */
function deployed(): Account {
  return { ...emptyAccount(), bindings: [{ name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" }, { name: "DB", type: "d1", id: "database-1" }, { name: "ZONE", type: "json", json: { account_address: "example" } }] };
}

/** Every object of the install, in the order the table shows them, each in the state `states` gives its kind, or `all`. */
function table(states: Readonly<Record<string, string>>): string[] {
  const state = (object: string): string => states[object] ?? states.all ?? "present";
  const variable = state("variable");

  return [
    `Forwarder | ${state("forwarders")} | poplin-private: https://poplin-private.example.workers.dev (private sites)`,
    `Forwarder | ${state("forwarders")} | poplin-sites: https://poplin-sites.example.workers.dev (unlisted and public sites)`,
    `Access application | ${state("access")} | poplin: poplin.example.workers.dev, poplin-private.example.workers.dev`,
    `Access policy | ${state("access")} | poplin logins`,
    `Access open paths | ${state("access")} | poplin open paths: poplin.example.workers.dev/api, poplin.example.workers.dev/setup`,
    `Access open paths | ${state("access")} | poplin open paths policy`,
    `Worker variable | ${variable} | ${variable === "missing" ? "ACCESS: written once the Access application exists" : "ACCESS"}`,
    `Key | ${state("key")} | poplin kept key`,
    `D1 database | ${state("database")} | poplin`,
  ];
}

function shown(reading: DomainReading): string[] {
  if (!reading.ok) return [`refused: ${reading.refusal}`];

  return reading.rows.map((row) => `${row.object} | ${row.state} | ${row.detail}`);
}

function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`);
}

/** Run a test against an account at the fake API, with the plug of a set install bound to it. */
async function withAccount(account: Account, run: (plug: ReturnType<typeof createPathPlug>, asked: readonly Asked[], baseUrl: string | undefined) => Promise<void>): Promise<void> {
  await withFake(
    (asked) => answer(account, asked),
    (connection, asked) => run(createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl: connection.baseUrl }), asked, connection.baseUrl),
  );
}

// Drift: an install on the free address has no zone. A row of a record, a route, or a rule there would be one no repair can ever make, and a call under a zone would be refused for a right the token is never asked for.
test("a check of an account with nothing in it names the two forwarders, the login, the variable, the key, and the database as missing, no piece of a zone, and sends no change and no call under a zone", async () => {
  const account = deployed();
  const before = structuredClone(account);

  await withAccount(account, async (plug, asked) => {
    const reading = await plug.check(TOKEN, SETTINGS);

    expect(shown(reading)).toEqual(table({ all: "missing" }));
    expect([writes(asked), asked.filter((entry) => entry.path.startsWith("/zones")), account]).toEqual([[], [], before]);
  });
});

// Drift: the count is what one request of a Worker spends on a repair: past 50 the setup page's one press could not finish on the free plan.
test("a repair makes every object in 24 calls, the forwarders bound to the one Worker and the login over the dashboard and the whole private host; a check then finds all present, and a second repair sends no change", async () => {
  const account = deployed();

  await withAccount(account, async (plug, asked) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created" }));
    expect(asked).toHaveLength(24);
    expect(account.workers).toEqual(
      ["poplin-sites", "poplin-private"].map((id) => ({ id, tags: ["poplin-forwarder"], bindings: [{ type: "service", name: "POPLIN", service: "poplin" }], enabled: true, previews_enabled: false })),
    );
    expect(account.applications.map((application) => (application.destinations as { uri: string }[]).map((place) => place.uri))).toEqual([
      ["poplin.example.workers.dev/api", "poplin.example.workers.dev/setup"],
      ["poplin.example.workers.dev", "poplin-private.example.workers.dev"],
    ]);
    expect(account.bindings.slice(3)).toEqual([
      { name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications.find((application) => application.name === "poplin")?.aud } },
      { name: "KEPT_KEY", type: "secret_text" },
    ]);

    const sent = asked.length;

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({}));
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({}));
    expect(writes(asked.slice(sent))).toEqual([]);
  });
});

// Drift: with somebody's own Worker at a forwarder's name and every other piece in place, a run would say that nothing is left to repair while the open sites still reach that other Worker.
test.each(["check", "repair"] as const)("a %s of an install whose open sites' name is held by a Worker that is not poplin's fails at that forwarder, says why, and never touches the Worker", async (run) => {
  const account = deployed();

  await withAccount(account, async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const theirs = { id: "poplin-sites", tags: [], bindings: [], enabled: true, previews_enabled: true };
    account.workers.splice(0, 1, { ...theirs });
    const sent = asked.length;
    const reading = await plug[run](TOKEN, SETTINGS);

    expect(shown(reading)).toEqual([
      "Forwarder | present | poplin-private: https://poplin-private.example.workers.dev (private sites)",
      "Forwarder | failed | poplin-sites: a Worker of this name is not poplin's: rename or delete it",
      ...table({}).slice(2),
    ]);
    expect(reading.ok ? runDone(run, reading, false).summary : undefined).toEqual({ line: "1 not done", tone: "bad" });
    expect([writes(asked.slice(sent)), account.workers[0]]).toEqual([[], theirs]);
  });
});

// Drift: the key of an install with a zone carries rights on that zone. Asked for here, the key could not be made: an account with no zone has no place to allow them on.
test("the key a repair makes is allowed on the account alone, and its value goes into the one change of the Worker and into no row", async () => {
  const account = deployed();

  await withAccount(account, async (plug, asked) => {
    const repaired = await plug.repair(TOKEN, SETTINGS);

    expect(account.tokens.map((token) => (token.policies as { resources: object }[]).map((policy) => Object.keys(policy.resources)))).toEqual([[[`com.cloudflare.api.account.${ACCOUNT}`]]]);
    expect(asked.filter((entry) => JSON.stringify(entry.body ?? "").includes(KEY_VALUE_START)).map((entry) => entry.method)).toEqual(["PATCH"]);
    expect(JSON.stringify(repaired).includes(KEY_VALUE_START)).toBe(false);
  });
});

// Drift: with no zone to show, the account's free address is the only proof a token is of this install. A token taken for showing any account would let a stranger's token read the install's rows.
test("a token of another account, a malformed one, and one Cloudflare does not know are refused alike by a check, a repair, and a new key: no setting is read, and nothing of the account is read or changed", async () => {
  const account = deployed();
  const before = structuredClone(account);

  await withAccount(account, async (plug, asked, baseUrl) => {
    const give = (token: string): Promise<DomainReading> => givePathKey({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl }, token);
    const tokens = [OTHER_TOKEN, "short", "token-nobody-has-0123456789"];
    let read = 0;
    const counted = async (): Promise<DomainSettings> => {
      read += 1;

      return STORED;
    };
    const readings = await Promise.all(tokens.flatMap((token) => [plug.check(token, counted), plug.repair(token, counted), give(token)]));

    expect([readings.every((reading) => JSON.stringify(reading) === JSON.stringify(REFUSED)), account, read]).toEqual([true, before, 0]);
    expect([...new Set(asked.map((entry) => entry.path))]).toEqual([`/accounts/${ACCOUNT}/workers/subdomain`]);
  });
});

// Drift: a new key is the one paste left after install. One that also ran a repair would change the forwarders or the login with a token pasted for the key alone.
test("a new key replaces the one the install holds and changes nothing else: one row, the secret written, and no forwarder, application, or database made", async () => {
  const account = deployed();

  await withAccount(account, async (_plug, asked, baseUrl) => {
    const key = { has: () => true, verify: async () => ({ ok: false, refusal: "key_refused" }) as const };
    const given = await givePathKey({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl, key }, TOKEN);

    expect(shown(given)).toEqual(["Key | changed | poplin kept key"]);
    expect([account.bindings.at(-1), account.workers, account.applications, account.databases]).toEqual([{ name: "KEPT_KEY", type: "secret_text" }, [], [], []]);
    expect(writes(asked).map((call) => call.split(" ")[0])).toEqual(["POST", "PATCH"]);
  });
});

// Drift: an install without a domain has no zone, so its key carries the account's rights alone. Judged as a domain's key it would be replaced at every repair; judged by any token of the name, a key a failed write left would hide the one the Worker holds.
test("a repair judges the key the Worker holds by the account's rights alone: a whole one stands and a spare of its name goes, and one that lacks a right is replaced though a whole spare is active", async () => {
  const groups = emptyAccount().groups.flatMap((group) => ((group.scopes as string[]).includes("com.cloudflare.api.account") ? [{ id: group.id }] : []));
  const whole = { id: "held-key", name: "poplin kept key", status: "active", policies: [{ effect: "allow", permission_groups: groups, resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" } }] };
  const early = { ...whole, policies: whole.policies.map((policy) => ({ ...policy, permission_groups: groups.filter(({ id }) => !String(id).startsWith("Workers Scripts Write")) })) };
  const key = { has: () => true, verify: async () => ({ ok: true, value: { id: "held-key" } }) as const };
  const rowOf = async (held: typeof whole): Promise<unknown> => {
    const account = { ...deployed(), tokens: [held, { ...whole, id: "spare-key" }] };
    let rows: string[] = [];
    await withAccount(account, async (_plug, _asked, baseUrl) => {
      rows = shown(await createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl, key }).repair(TOKEN, SETTINGS));
    });

    return [rows.filter((row) => row.startsWith("Key | ")), account.tokens.map((token) => token.id === "held-key")];
  };

  expect([await rowOf(whole), await rowOf(early)]).toEqual([
    [["Key | changed | poplin kept key: a key of its name that the install does not hold was deleted"], [true]],
    [["Key | changed | poplin kept key"], [false]],
  ]);
});

// Drift: the owner's list. A right of a zone on the form would ask a person with no domain for something their account cannot give.
test("the token form asks for the five rights of an install without a domain and names no zone", async () => {
  const plug = createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES });
  const link = new URL(plug.tokenLink);

  expect([[...plug.tokenRights].sort(), plug.tokenOptional, link.searchParams.has("zoneId"), plug.tokenNote.includes("Zone")]).toEqual([[...RIGHTS].sort(), [], false, false]);
});
