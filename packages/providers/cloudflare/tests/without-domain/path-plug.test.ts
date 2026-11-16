// The plug of an install without a domain against a whole account at the fake API.
// Without these the second kind of install could drift from the first unnoticed: a row of the domain's pieces on an install that has no zone, a token that proves itself by anything but the account's free address, or a key with a zone's rights.

import { expect, test } from "bun:test";
import type { DomainReading, DomainSettings } from "@poplin/app/src/console/domain/records";
import { runDone } from "../../../../app/src/console/domain-answers";
import type { Login } from "@poplin/core/src/auth/logins";
import { createPathPlug, givePathKey } from "../../src/without-domain/path-plug";
import { withFake } from "../shared/install/support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, KEPT, KEY_VALUE_START, OTHER_TOKEN, TEAM, TOKEN } from "../shared/install/support/fake-install";
import { ADDRESSES } from "../shared/install/support/layouts";
import type { Asked } from "../shared/install/support/replies";

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

/** The one optional right of the token, with what its piece's row says where the token lacks it. */
const OPTIONAL = {
  right: "Notifications: Edit",
  adds: "Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar.",
  how: "An install whose key Cloudflare takes makes it by itself within a day. To make it now, add this right to the account token and press Repair: Notifications: Edit",
} as const;

/** The budget alert's row where a token lacks the right, which may not read the alert's name, and where a check by the key finds none set up. */
const NO_ALERT = { token: `Budget alert | optional | ${OPTIONAL.adds} ${OPTIONAL.how}`, key: `Budget alert | optional | poplin: usage charges reached 1 dollar: ${OPTIONAL.adds} ${OPTIONAL.how}` } as const;

/** Every object of the install, in the order the table shows them, each in the state `states` gives its kind, or `all`. */
function table(states: Readonly<Record<string, string>>): string[] {
  const state = (object: string): string => states[object] ?? states.all ?? "present";
  const variable = state("variable");

  return [
    `Forwarder | ${state("forwarders")} | poplin-private: https://poplin-private.example.workers.dev (private sites)`,
    `Forwarder | ${state("forwarders")} | poplin-sites: https://poplin-sites.example.workers.dev (unlisted and public sites)`,
    `Access application | ${state("access")} | poplin: poplin.example.workers.dev, poplin-private.example.workers.dev`,
    `Access policy | ${state("access")} | poplin logins`,
    `Access open paths | ${state("access")} | poplin open paths: poplin.example.workers.dev/api`,
    `Access open paths | ${state("access")} | poplin open paths policy`,
    `Worker variable | ${variable} | ${variable === "missing" ? "ACCESS: written once the Access application exists" : "ACCESS"}`,
    `Key | ${state("key")} | poplin kept key`,
    `Upload key | ${state("key")} | poplin upload key`,
    `D1 database | ${state("database")} | poplin`,
    `Budget alert | ${state("alert")} | poplin: usage charges reached 1 dollar`,
    `Workflow | ${state("jobs")} | poplin-jobs`,
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
test("a check of an account with nothing in it names the two forwarders, the login, the variable, the key, the database, the budget alert, and the Workflow as missing, no piece of a zone, and sends no change and no call under a zone", async () => {
  const account = deployed();
  const before = structuredClone(account);

  await withAccount(account, async (plug, asked) => {
    const reading = await plug.check(TOKEN, SETTINGS);

    expect(shown(reading)).toEqual(table({ all: "missing" }));
    expect([writes(asked), asked.filter((entry) => entry.path.startsWith("/zones")), account]).toEqual([[], [], before]);
  });
});

// Drift: the count is what one request of a Worker spends on a repair: past 50 the Domain screen's one press could not finish on the free plan.
test("a repair makes every object in 29 calls, the forwarders bound to the one Worker and the login over the dashboard and the whole private host; a check then finds all present, and a second repair sends no change", async () => {
  const account = deployed();

  await withAccount(account, async (plug, asked) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created" }));
    expect(asked).toHaveLength(29);
    expect(account.workers).toEqual(
      ["poplin-sites", "poplin-private"].map((id) => ({ id, tags: ["poplin-forwarder"], bindings: [{ type: "service", name: "POPLIN", service: "poplin" }], enabled: true, previews_enabled: false })),
    );
    expect(account.applications.map((application) => (application.destinations as { uri: string }[]).map((place) => place.uri))).toEqual([
      ["poplin.example.workers.dev/api"],
      ["poplin.example.workers.dev", "poplin-private.example.workers.dev"],
    ]);
    expect(account.bindings.slice(3)).toEqual([
      { name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications.find((application) => application.name === "poplin")?.aud } },
      { name: "KEPT_KEY", type: "secret_text" },
      { name: "UPLOAD_KEY", type: "secret_text" },
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
test("the kept key a repair makes is allowed on the account alone and the upload key on the one bucket, and the kept key's value goes into the one change of the Worker and into no row", async () => {
  const account = deployed();

  await withAccount(account, async (plug, asked) => {
    const repaired = await plug.repair(TOKEN, SETTINGS);

    const allowedOn = account.tokens.map((token) => (token.policies as { resources: object }[]).map((policy) => Object.keys(policy.resources)));

    expect(allowedOn).toEqual([[[`com.cloudflare.api.account.${ACCOUNT}`]], [[`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_poplin-sites`]]]);
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

// Drift: new keys are the one paste left after install. One that also ran a repair would change the forwarders or the login with a token pasted for the keys alone.
test("new keys replace the kept key the install holds, make the upload key it lacks, and change nothing else: a row a key, both secrets in one change, and no forwarder, application, or database made", async () => {
  const account = deployed();

  await withAccount(account, async (_plug, asked, baseUrl) => {
    const key = { has: () => true, verify: async () => ({ ok: false, refusal: "key_refused" }) as const };
    const given = await givePathKey({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl, key }, TOKEN);

    expect(shown(given)).toEqual(["Key | changed | poplin kept key", "Upload key | created | poplin upload key"]);
    expect([account.bindings.slice(-2), account.workers, account.applications, account.databases]).toEqual([[{ name: "KEPT_KEY", type: "secret_text" }, { name: "UPLOAD_KEY", type: "secret_text" }], [], [], []]);
    expect(writes(asked).map((call) => call.split(" ")[0])).toEqual(["POST", "POST", "PATCH"]);
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

    return [rows.filter((row) => row.startsWith("Key | ")), account.tokens.filter((token) => token.name === "poplin kept key").map((token) => token.id === "held-key")];
  };

  expect([await rowOf(whole), await rowOf(early)]).toEqual([
    [["Key | changed | poplin kept key: a key of its name that the install does not hold was deleted"], [true]],
    [["Key | changed | poplin kept key"], [false]],
  ]);
});

// Drift: the upload key is judged by the same piece on both kinds of install. Left out of this one's repair, an install without a domain would keep a key of another bucket and send every file where no site is read from.
test("a repair judges the upload key the Worker holds by its one right on the install's bucket: a whole one stands, and one made for another bucket is replaced by one of the Worker's own", async () => {
  const groups = emptyAccount().groups.flatMap((group) => (group.name === "Workers R2 Storage Bucket Item Write" ? [{ id: group.id }] : []));
  const policyOn = (bucket: string): object => ({ effect: "allow", permission_groups: groups, resources: { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_${bucket}`]: "*" } });
  const on = (bucket: string): Record<string, unknown> => ({ id: "held-upload", name: "poplin upload key", status: "active", policies: [policyOn(bucket)] });
  const key = { has: () => true, verify: async () => ({ ok: true, value: { id: "held-key" } }) as const };
  const rowOf = async (bucket: string): Promise<unknown> => {
    const account = { ...deployed(), tokens: [on(bucket)] };
    let rows: string[] = [];
    await withAccount(account, async (_plug, _asked, baseUrl) => {
      rows = shown(await createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl, key, uploadKeyId: "held-upload" }).repair(TOKEN, SETTINGS));
    });
    const kept = account.tokens.map((token) => [token.id === "held-upload", (token.policies as { resources: object }[]).flatMap((policy) => Object.keys(policy.resources))]);

    return [rows.filter((row) => row.startsWith("Upload key | ")), kept];
  };

  expect([await rowOf("poplin-sites"), await rowOf("other-sites")]).toEqual([
    [["Upload key | present | poplin upload key"], [[true, [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_poplin-sites`]]]],
    [["Upload key | changed | poplin upload key"], [[false, [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_poplin-sites`]]]],
  ]);
});

// Drift: the owner's list. A right of a zone on the form would ask a person with no domain for something their account cannot give.
test("the token form asks for the five rights of an install without a domain, names the one optional right with what it adds, and names no zone", async () => {
  const plug = createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES });
  const link = new URL(plug.tokenLink);

  expect([[...plug.tokenRights].sort(), plug.tokenOptional, link.searchParams.has("zoneId"), plug.tokenNote.includes("Zone")]).toEqual([[...RIGHTS].sort(), [{ right: OPTIONAL.right, adds: OPTIONAL.adds }], false, false]);
});

// Drift: the start page tells a person the link's five rights are enough. An alert that failed without its right, or stopped the run before the Workflow, would make that page false on this kind of install alone.
test("a repair with a token without Notifications: Edit fails nothing: every other object is made, the alert's row is optional and names the right, and a check and a second repair leave it so", async () => {
  const account = { ...deployed(), refuse: `GET /accounts/${ACCOUNT}/alerting/v3/policies` };
  const rest = (states: Readonly<Record<string, string>>): string[] => table(states).map((row) => (row.startsWith("Budget alert") ? NO_ALERT.token : row));

  await withAccount(account, async (plug, asked) => {
    const reading = await plug.repair(TOKEN, SETTINGS);

    expect(shown(reading)).toEqual(rest({ all: "created" }));
    expect([asked.length, account.alerts, reading.ok ? runDone("repair", reading, false).summary : undefined]).toEqual([28, [], { line: "11 repaired", tone: "good" }]);

    const sent = asked.length;

    expect([shown(await plug.check(TOKEN, SETTINGS)), shown(await plug.repair(TOKEN, SETTINGS)), writes(asked.slice(sent))]).toEqual([rest({}), rest({}), []]);
  });
});

// Drift: the alert is mailed to the first user. One made for another address, or left as it was after the users changed, would warn somebody who no longer holds the account.
test("the alert a repair makes is the account's own, at 1 dollar, mailed to the first user alone, and a repair after the first user changed sends it to the new one", async () => {
  const account = deployed();

  await withAccount(account, async (plug) => {
    await plug.repair(TOKEN, SETTINGS);
    const first = structuredClone(account.alerts);
    const moved = async (): Promise<DomainSettings> => ({ ...STORED, logins: ["second@example.com" as Login, "owner@example.com" as Login] });
    const rows = shown(await plug.repair(TOKEN, moved));

    expect(first).toMatchObject([{ name: "poplin: usage charges reached 1 dollar", alert_type: "billing_budget_alert", enabled: true, filters: { total_spend_dollars: ["1"] }, mechanisms: { email: [{ id: "owner@example.com" }] } }]);
    expect([rows.filter((row) => row.startsWith("Budget alert")), account.alerts.map((alert) => alert.mechanisms)]).toEqual([["Budget alert | changed | poplin: usage charges reached 1 dollar"], [{ email: [{ id: "second@example.com" }] }]]);
  });
});

/** Run a test against an account at the fake API, with the plug of an install that holds its key. */
async function withKey(account: Account, run: (plug: ReturnType<typeof createPathPlug>, own: () => Promise<DomainReading>, asked: readonly Asked[]) => Promise<void>): Promise<void> {
  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const plug = createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES, baseUrl: connection.baseUrl, uploadKeyId: "held-upload-key", kept: { connection: { key: KEPT, baseUrl: connection.baseUrl } } });
      const own = plug.ownCheck;
      if (own === undefined) throw new Error("a plug with a key has no check of its own");

      await run(plug, () => own(SETTINGS), asked);
    },
  );
}

// Drift: the count is what one request of a Worker spends each time the Domain screen opens on a check that is old. With no token to prove, a call for the account's free address, to the databases, or to the tokens is one the check has no use for.
test("an install that holds its key checks with no token: every piece a repair made reads as present in 16 calls, each a read sent with the key, and the database's row says the install runs on it", async () => {
  const account = deployed();

  await withKey(account, async (plug, own, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const sent = asked.length;
    const rows = shown(await own());
    const calls = asked.slice(sent);

    expect(rows).toEqual(table({}).map((row) => (row.startsWith("D1 database") ? "D1 database | present | poplin: the install is running on it" : row)));
    expect([calls.length, [...new Set(calls.map((call) => `${call.method} ${call.key}`))], calls.filter((call) => /\/(d1|tokens|workers\/subdomain)(\/|\?|$)/.test(call.path))]).toEqual([16, [`GET Bearer ${KEPT}`], []]);
  });
});

// Drift: the key can see that the alert is absent, and no token says the person wants it. Read as missing, an install set up with the five rights alone would rest on a count to repair that a repair with its own token cannot clear.
test("a check by the key of an account with no alert reads the alert as optional, in the words a token without its right is told, and sends nothing but reads", async () => {
  const account = deployed();

  await withKey(account, async (plug, own, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    account.alerts.splice(0);
    const sent = asked.length;
    const rows = shown(await own());

    expect([rows.filter((row) => row.startsWith("Budget alert")), writes(asked.slice(sent))]).toEqual([[NO_ALERT.key], []]);
  });
});

// Drift: a key made before a right was added lacks it, and one deleted at Cloudflare is refused. A check that read either as a healthy install, or stopped with no word of the key, would never send the person to the repair that makes a new one.
test.each([
  {
    name: "lacks the right to read the team's domain fails that row alone and names the right",
    refuse: `GET /accounts/${ACCOUNT}/access/organizations`,
    as: undefined,
    rows: [
      "Worker variable | failed | the team's domain: the key the install holds lacks this right: Access: Organizations, Identity Providers, and Groups Read. Press Repair.",
      "Key | differs | poplin kept key: the key the install holds lacks a right the install uses now",
      "Upload key | not-run | ",
      "D1 database | present | poplin: the install is running on it",
    ],
  },
  {
    name: "lacks the right to read the budget alert fails that row alone and names the right",
    refuse: `GET /accounts/${ACCOUNT}/alerting/v3/policies`,
    as: undefined,
    rows: [
      "Key | differs | poplin kept key: the key the install holds lacks a right the install uses now",
      "D1 database | present | poplin: the install is running on it",
      "Budget alert | failed | the key the install holds lacks this right: Notifications Write. Press Repair.",
    ],
  },
  {
    name: "Cloudflare refuses at the forwarders stops there",
    refuse: `GET /accounts/${ACCOUNT}/workers/scripts*`,
    as: { status: 401, code: 10000 },
    rows: [
      "Forwarder | failed | Cloudflare refused the key the install holds. Press Repair.",
      "Access application | not-run | ",
      "Worker variable | not-run | ",
      "Key | differs | poplin kept key: Cloudflare refused the key the install holds",
      "Upload key | not-run | ",
      "D1 database | not-run | ",
      "Budget alert | not-run | ",
      "Workflow | not-run | ",
    ],
  },
])("a key that $name: the key's row says a repair replaces it", async ({ refuse, as, rows }) => {
  const account = deployed();

  await withKey(account, async (plug, own) => {
    await plug.repair(TOKEN, SETTINGS);
    account.refuse = refuse;
    if (as !== undefined) account.refuseAs = as;
    const read = shown(await own());

    expect(read.filter((row) => !table({}).includes(row))).toEqual([...rows]);
  });
});

// Drift: an install that is being made holds no key. A check of its own would call Cloudflare with nothing, and the screen would stop asking for the token it needs.
test("an install that holds no key has no check of its own", async () => {
  expect(createPathPlug({ accountId: ACCOUNT, script: "poplin", layout: ADDRESSES }).ownCheck).toBeUndefined();
});
