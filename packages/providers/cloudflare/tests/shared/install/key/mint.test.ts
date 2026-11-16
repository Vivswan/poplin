// Making the keys an install keeps, against a whole account at the fake API: what is sent, what is left at Cloudflare, and what the answer says.
// Without these a key could be made with other rights than the list, stay at Cloudflare with nothing holding it, or come back out of the one function that sees it.

import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { INSTALL_OBJECTS } from "../../../../src/shared/install/install-objects";
import { mintKeys, type WantedKey } from "../../../../src/shared/install/key/mint";
import { keyPolicies, uploadKeyPolicies } from "../../../../src/shared/install/key/rights";
import { reportOf, type Synced } from "../../../../src/shared/install/sync";
import { withFake } from "../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, KEY_VALUE_START, TOKEN } from "../support/fake-install";

/** The name every kept key of an install has. */
const NAME = INSTALL_OBJECTS.keyName;

/** The name every upload key of an install has. */
const UPLOAD_NAME = INSTALL_OBJECTS.uploadKeyName;

/** The kept key's place on an install with a domain. */
const PLACE = { accountId: ACCOUNT, zoneId: "zone-1" };

/** The install's bucket. */
const BUCKET = { name: "poplin-sites" };

/** What marks the part of a kept text that is as secret as the key's value. */
const SECRET_START = "hash-of-";

/** The kept key as a run makes it: the install keeps its value as it is. */
const KEPT: WantedKey = { name: NAME, policies: (groups) => keyPolicies(PLACE, groups), text: async ({ value }) => ({ text: value, secrets: [] }) };

/** The upload key as a run makes it: the install keeps a text that holds a secret made of the value, and not the value. */
const UPLOAD: WantedKey = {
  name: UPLOAD_NAME,
  policies: (groups) => uploadKeyPolicies({ accountId: ACCOUNT, bucket: BUCKET }, groups),
  text: async ({ id, value }) => ({ text: `{"id":"${id}","secret":"${SECRET_START}${value.length}"}`, secrets: [`${SECRET_START}${value.length}`] }),
};

/** The path every run asks first. */
const GROUPS = `GET /accounts/${ACCOUNT}/tokens/permission_groups`;

/** The list of the account's tokens, which a run that kept a key asks page by page: the page that holds them, and the empty one after it. */
const LIST = [`GET /accounts/${ACCOUNT}/tokens`, `GET /accounts/${ACCOUNT}/tokens`];

/** An older kept key of the install. */
const OLD = { id: "old-key", name: NAME, status: "active" };

/** An older upload key of the install. */
const OLD_UPLOAD = { id: "old-upload-key", name: UPLOAD_NAME, status: "active" };

/** A token of the account that is nobody's key. */
const OTHER = { id: "other-token", name: "deploys", status: "active" };

/** A write that works. */
const WRITTEN: Synced = { ok: true, report: reportOf([]) };

/** A write Cloudflare refuses with a message that quotes what it was sent. */
const quoting = (texts: readonly string[]): Synced => ({ ok: false, failure: "refused", status: 400, errors: [{ code: 10021, message: `bad binding ${texts.join(" and ")}` }], report: reportOf([]), failed: "" });

/** One run: the account it meets, the keys it is to make, how the write goes, and what it comes to. `calls` is every call after the list of groups, with a made key's id as `key-N`. */
interface Row {
  readonly name: string;
  readonly account?: Partial<Account>;
  readonly wanted?: readonly WantedKey[];
  readonly keep?: (texts: readonly string[]) => Promise<Synced>;
  readonly minted: readonly unknown[];
  readonly calls: readonly string[];
  readonly left: readonly string[];
}

/** The call that deletes a key a run made. */
const DELETE_NEW = `DELETE /accounts/${ACCOUNT}/tokens/key-N`;

/** The call that makes a key. */
const CREATE = `POST /accounts/${ACCOUNT}/tokens`;

/** What a maker with no right for a call is answered. */
const NOT_PERMITTED = { ok: false, failure: "refused", status: 403, errors: [{ code: 10000, message: `Authentication error for Bearer ${TOKEN}` }] };

/** A key that was made and kept, with no older one left. */
const KEPT_CLEAN = { ok: true, kept: WRITTEN, stale: false };

/** The rights a kept key is kept from: what changes a record, a route, a redirect, or a bot switch, and what makes another key. */
const KEPT_FROM = ["DNS Write", "Workers Routes Write", "Dynamic URL Redirects Write", "Bot Management Write", "Account API Tokens Write"];

/** Every way a run can go. */
const rows: readonly Row[] = [
  { name: "an account with no key", minted: [KEPT_CLEAN], calls: [CREATE, ...LIST], left: [NAME] },
  {
    name: "an account with an older key and a token that is nobody's key: the older key goes once the new one is kept, and the other token stays",
    account: { tokens: [OLD, OTHER] },
    minted: [KEPT_CLEAN],
    calls: [CREATE, ...LIST, `DELETE /accounts/${ACCOUNT}/tokens/old-key`],
    left: ["deploys", NAME],
  },
  {
    name: "an older key Cloudflare will not delete: the new key is kept, and the answer says an old one is left",
    account: { tokens: [OLD], refuse: `DELETE /accounts/${ACCOUNT}/tokens/old-key` },
    minted: [{ ok: true, kept: WRITTEN, stale: true }],
    calls: [CREATE, ...LIST, `DELETE /accounts/${ACCOUNT}/tokens/old-key`],
    left: [NAME, NAME],
  },
  {
    name: "a list of groups with one right's name gone",
    account: { groups: emptyAccount().groups.filter((group) => group.name !== "DNS Read") },
    minted: [{ ok: false, made: false, why: { ok: false, failure: "no-group", message: "Cloudflare lists no permission group named DNS Read" } }],
    calls: [],
    left: [],
  },
  {
    name: "a right listed for the account alone, where the key needs it on the zone",
    account: { groups: emptyAccount().groups.map((group) => (group.name === "Zone WAF Write" ? { ...group, scopes: ["com.cloudflare.api.account"] } : group)) },
    minted: [{ ok: false, made: false, why: { ok: false, failure: "no-group", message: "Cloudflare lists no permission group named Zone WAF Write" } }],
    calls: [],
    left: [],
  },
  { name: "a maker that may not list the groups", account: { refuse: GROUPS }, wanted: [KEPT, UPLOAD], minted: [{ ok: false, made: false, why: NOT_PERMITTED }, { ok: false, made: false, why: NOT_PERMITTED }], calls: [], left: [] },
  { name: "a maker that may not make a token", account: { refuse: CREATE }, minted: [{ ok: false, made: false, why: NOT_PERMITTED }], calls: [CREATE], left: [] },
  {
    name: "a create Cloudflare fails is sent once: a second try could make a second token whose id never comes back",
    account: { refuse: CREATE, refuseAs: { status: 502, code: 1 }, refuseMessage: "Bad gateway" },
    minted: [{ ok: false, made: false, why: { ok: false, failure: "refused", status: 502, errors: [{ code: 1, message: "Bad gateway" }] } }],
    calls: [CREATE],
    left: [],
  },
  {
    name: "a list of tokens Cloudflare refuses once the key is kept: the answer says an older key may be left",
    account: { tokens: [OLD], refuse: LIST[0] ?? "" },
    minted: [{ ok: true, kept: WRITTEN, stale: true }],
    calls: [CREATE, LIST[0] ?? ""],
    left: [NAME, NAME],
  },
  {
    name: "a write Cloudflare refuses, quoting the key: the new key is deleted, and the quote has no key in it",
    keep: async (texts) => quoting(texts),
    minted: [{ ok: false, made: true, kept: quoting(["[key]"]), left: false }],
    calls: [CREATE, DELETE_NEW],
    left: [],
  },
  {
    name: "a write that fails and a new key Cloudflare will not delete: the answer says it is left",
    account: { refuse: `DELETE /accounts/${ACCOUNT}/tokens/*` },
    keep: async (texts) => quoting(texts),
    minted: [{ ok: false, made: true, kept: quoting(["[key]"]), left: true }],
    calls: [CREATE, DELETE_NEW],
    left: [NAME],
  },
  {
    name: "a write that ends with an exception whose text holds the key",
    keep: async (texts) => Promise.reject(new Error(`cut at ${texts.join(" and ")}`)),
    minted: [{ ok: false, made: true, kept: { ok: false, failure: "network", message: "the change of the Worker's settings was cut short", report: reportOf([]) }, left: false }],
    calls: [CREATE, DELETE_NEW],
    left: [],
  },
  {
    name: "a write that fails with an older key there: the older key stays, since it is the one the install may still hold",
    account: { tokens: [OLD] },
    keep: async (texts) => quoting(texts),
    minted: [{ ok: false, made: true, kept: quoting(["[key]"]), left: false }],
    calls: [CREATE, DELETE_NEW],
    left: [NAME],
  },
  {
    name: "both keys on an account with an older one of each: one list of groups, one write, one list of tokens, and each older key goes",
    account: { tokens: [OLD, OLD_UPLOAD, OTHER] },
    wanted: [KEPT, UPLOAD],
    minted: [KEPT_CLEAN, KEPT_CLEAN],
    calls: [CREATE, CREATE, ...LIST, `DELETE /accounts/${ACCOUNT}/tokens/old-key`, `DELETE /accounts/${ACCOUNT}/tokens/old-upload-key`],
    left: ["deploys", NAME, UPLOAD_NAME],
  },
  {
    name: "both keys where Cloudflare lists no group for the bucket: the kept key is made and written alone",
    account: { groups: emptyAccount().groups.filter((group) => group.name !== "Workers R2 Storage Bucket Item Write") },
    wanted: [KEPT, UPLOAD],
    minted: [KEPT_CLEAN, { ok: false, made: false, why: { ok: false, failure: "no-group", message: "Cloudflare lists no permission group named Workers R2 Storage Bucket Item Write" } }],
    calls: [CREATE, ...LIST],
    left: [NAME],
  },
  {
    name: "both keys where the making of the second ends with an exception: the first is still written, and nothing is left that no install holds",
    wanted: [
      KEPT,
      {
        ...UPLOAD,
        policies: () => {
          throw new Error("cut");
        },
      },
    ],
    minted: [KEPT_CLEAN, { ok: false, made: false, why: { ok: false, failure: "no-value", message: "the answer about the new key was cut short, and a token named poplin upload key may be left there" } }],
    calls: [CREATE, ...LIST],
    left: [NAME],
  },
  {
    name: "both keys and a write Cloudflare refuses, quoting both: each new key is deleted, and the quote holds no value and no secret made of one",
    wanted: [KEPT, UPLOAD],
    keep: async (texts) => quoting(texts),
    minted: [
      { ok: false, made: true, kept: quoting(["[key]", "[key]"]), left: false },
      { ok: false, made: true, kept: quoting(["[key]", "[key]"]), left: false },
    ],
    calls: [CREATE, CREATE, DELETE_NEW, DELETE_NEW],
    left: [],
  },
];

describe("mintKeys", () => {
  let logs: Mock<(...said: unknown[]) => void>[] = [];

  beforeEach(() => {
    logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation(() => undefined));
  });

  afterEach(() => {
    for (const log of logs) log.mockRestore();
  });

  // Drift: each row is a way a key could be left at Cloudflare with nothing holding it, or leave the function that made it.
  test.each(rows)("$name", async ({ account = {}, wanted = [KEPT], keep = async () => WRITTEN, minted, calls, left }) => {
    const held = { ...emptyAccount(), ...account };
    const seen: string[][] = [];

    await withFake(
      (asked) => answer(held, asked),
      async (connection, asked) => {
        const outcomes = await mintKeys({ ...connection, key: TOKEN }, ACCOUNT, wanted, (texts) => {
          seen.push(texts.map(({ key }) => key.name));

          return keep(texts.map(({ text }) => text));
        });
        const answered = outcomes.map(({ minted: outcome }) => outcome);
        const sent = asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`.replace(/key-\d+$/, "key-N"));
        const said = [JSON.stringify(answered), Bun.inspect(answered), ...logs.flatMap((log) => log.mock.calls.map((call) => Bun.inspect(call)))].join("\n");

        expect<unknown>(answered).toEqual(minted);
        expect(sent).toEqual([GROUPS, ...calls]);
        expect(held.tokens.map((token) => token.name).sort()).toEqual([...left].sort());
        // The write runs once at most, each wanted key is answered for in its order, and nothing that is said holds a value or a secret made of one.
        expect([seen.length <= 1, outcomes.map(({ key }) => key.name), said.includes(KEY_VALUE_START), said.includes(SECRET_START), logs.flatMap((log) => log.mock.calls)]).toEqual([true, wanted.map((key) => key.name), false, false, []]);
      },
    );
  });

  const places = [
    { name: "an install with a domain: the account's policy and the zone's", wanted: KEPT, resources: [{ [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, { "com.cloudflare.api.account.zone.zone-1": "*" }] },
    {
      name: "an install with no domain: the account's policy alone",
      wanted: { ...KEPT, policies: (groups) => keyPolicies({ accountId: ACCOUNT }, groups) } satisfies WantedKey,
      resources: [{ [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }],
    },
  ];

  // Drift: the body is the whole of what the key may do. A right more is a key that can change DNS; an expiry is an install whose key stops on a day nobody chose.
  test.each(places)("$name, each right by the id Cloudflare lists under its name, with no end date", async ({ wanted, resources }) => {
    const held = emptyAccount();

    await withFake(
      (asked) => answer(held, asked),
      async (connection, asked) => {
        await mintKeys({ ...connection, key: TOKEN }, ACCOUNT, [wanted], async () => WRITTEN);
        const body = asked.find((entry) => entry.method === "POST")?.body as { name: string; policies: { effect: string; permission_groups: { id: string }[]; resources: unknown }[] };
        const scopes = ["com.cloudflare.api.account", "com.cloudflare.api.account.zone"];
        const sent = body.policies.map((policy) => policy.permission_groups.map((group) => held.groups.find((listed) => listed.id === group.id)));

        expect(Object.keys(body).sort()).toEqual(["name", "policies"]);
        expect([body.name, body.policies.map((policy) => policy.effect), body.policies.map((policy) => policy.resources)]).toEqual([NAME, resources.map(() => "allow"), resources]);
        // Every id sent is one Cloudflare lists under the scope of the policy that carries it: of the two groups named Access: Apps and Policies Write, the account's. None is a right the key is kept from.
        expect(sent.map((groups) => [...new Set(groups.flatMap((group) => (group?.scopes ?? ["an id Cloudflare does not list"]) as string[]))])).toEqual(scopes.slice(0, resources.length).map((scope) => [scope]));
        expect(sent.flat().map((group) => String(group?.name)).filter((right) => KEPT_FROM.includes(right))).toEqual([]);
        // The right an update of the install's own code is made with is on the account's policy: without it every update the install takes by itself is refused for the right.
        expect(sent.map((groups) => groups.some((group) => group?.name === "Workers Scripts Write"))).toEqual(resources.map((_, index) => index === 0));
      },
    );
  });

  const buckets = [
    { name: "a bucket of no jurisdiction", bucket: BUCKET, resource: `com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_poplin-sites` },
    { name: "a bucket made in a jurisdiction", bucket: { name: "poplin-sites", jurisdiction: "eu" }, resource: `com.cloudflare.edge.r2.bucket.${ACCOUNT}_eu_poplin-sites` },
  ];

  // Drift: this body is everything the upload key reaches. A second group, a second resource, or the account's own resource is a key that reaches another bucket or more than objects.
  test.each(buckets)("the upload key of $name is sent with one policy: the one group that writes objects, on that one bucket at the top of the policy", async ({ bucket, resource }) => {
    const held = emptyAccount();

    await withFake(
      (asked) => answer(held, asked),
      async (connection, asked) => {
        await mintKeys({ ...connection, key: TOKEN }, ACCOUNT, [{ ...UPLOAD, policies: (groups) => uploadKeyPolicies({ accountId: ACCOUNT, bucket }, groups) }], async () => WRITTEN);
        const body = asked.find((entry) => entry.method === "POST")?.body;

        expect<unknown>(body).toEqual({
          name: UPLOAD_NAME,
          policies: [{ effect: "allow", permission_groups: [{ id: "Workers R2 Storage Bucket Item Write of com.cloudflare.edge.r2.bucket" }], resources: { [resource]: "*" } }],
        });
      },
    );
  });
});
