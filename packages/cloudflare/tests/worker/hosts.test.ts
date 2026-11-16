// The one Worker started as each kind of install: with a domain, and on the account's free address with no domain.
// Without these the kind could be read in one place and forgotten in another: a site answered on the dashboard's hostname, the API on a site's, or every hostname of the free address still answered as a setup page.

import { reset } from "cloudflare:test";
import { sha256Of } from "@poplin/core/src/storage/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Bindings } from "../../src/worker/bindings";
import { signer } from "../login/support/access";
import { ADMIN, type ApiCalls, accessHeaders, ask, api, BINDINGS, countedBindings, done, installOf, instance, OWNER, problemsOf, type Published, page, publish, send, spentDatabase, tokenOf, type Worker, type World, world } from "./support/install";

/** The admin host of the install without a domain: the Worker's own free address under the account `example`. */
const FREE_ADMIN = "https://poplin.example.workers.dev";

/** Where its unlisted and public sites answer. */
const SITES = "https://poplin-sites.example.workers.dev";

/** Where its private sites answer. */
const PRIVATE = "https://poplin-private.example.workers.dev";

/** A site's id in its form, which no site of a test holds. */
const NO_SITE = "000000000000";

/** One kind of install, as a test starts it: the bindings its Worker carries, and where its dashboard answers. */
interface Kind {
  readonly kind: string;
  readonly bindings: Bindings;
  readonly admin: string;
}

/** The two values the `ZONE` binding takes, each with the Worker name of wrangler.jsonc. */
const KINDS = {
  domain: { kind: "a domain", bindings: BINDINGS, admin: ADMIN },
  account: { kind: "an account address", bindings: { ...BINDINGS, ZONE: { account_address: "example" } } as Bindings, admin: FREE_ADMIN },
} as const satisfies Record<string, Kind>;

let w: World;

/** The API of an install of one kind, as the holder of a token asks it. */
function callsOf(worker: Worker, token: string | null, at: Kind): ApiCalls {
  return api(worker, token, (input, init) => ask(worker, input, init, at.bindings), at.admin);
}

/** Ask an install without a domain. */
function askFree(worker: Worker, url: string, init: RequestInit = {}): Promise<Response> {
  return ask(worker, url, init, KINDS.account.bindings);
}

/** The status of an answer, where it sends the browser, and its text. */
async function told(answer: Response): Promise<readonly [number, string | null, string]> {
  return [answer.status, answer.headers.get("Location"), await answer.text()];
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("a ZONE binding that names no install", () => {
  const refused: readonly { readonly name: string; readonly zone: unknown; readonly says: string; readonly hides: string }[] = [
    {
      name: "both a domain and an account address",
      zone: { domain: "example.com", account_address: "hidden-account" },
      says: "  ZONE: bad-shape. It holds a domain, with or without a public word, or an account address: one of the two, never both, and each as text.",
      hides: "hidden-account",
    },
    { name: "neither of the two", zone: { note: "hidden-note" }, says: "  ZONE: bad-shape. It holds a domain, with or without a public word, or an account address: one of the two, never both, and each as text.", hides: "hidden-note" },
    {
      name: "the whole free address in place of the account's name",
      zone: { account_address: "hidden-account.workers.dev" },
      says: "  ZONE: bad-account. Its account address is the account's name alone, the part between the Worker's name and workers.dev.",
      hides: "hidden-account",
    },
    { name: "an account's name with a capital", zone: { account_address: "Hidden" }, says: "  ZONE: bad-account.", hides: "Hidden" },
    { name: "an account's name of 37 characters", zone: { account_address: "h".repeat(37) }, says: "  ZONE: account-too-long. Its account address is too long for the addresses of the login.", hides: "hhhh" },
    { name: "a domain that is one label", zone: { domain: "hidden" }, says: "  ZONE: bad-domain. Its domain is no domain.", hides: "hidden" },
  ];

  // Drift: a binding of neither kind that started an instance would serve under hosts nobody chose; one that failed on every request would say nothing a person can act on.
  test.each(refused)("$name stops the start with the rule it breaks and one sentence, without the value, and the same instance starts once the binding is right", async ({ zone, says, hides }) => {
    const worker = instance(w);
    const failed = await ask(worker, `${SITES}/docs/`, {}, { ...BINDINGS, ZONE: zone } as Bindings);
    const text = await failed.text();
    const recovered = await askFree(worker, `${FREE_ADMIN}/api/whoami`);

    expect([failed.status, failed.headers.get("Cache-Control"), text.includes(says), text.includes(hides)]).toEqual([503, "no-store", true, false]);
    expect(recovered.status).toBe(401);
  });

  // Drift: the free address is made from the Worker's name, so a name no hostname starts with must stop the start and never make a host.
  test("an account address on a Worker whose name no hostname starts with is refused for the name", async () => {
    const failed = await ask(instance(w), `${FREE_ADMIN}/`, {}, { ...KINDS.account.bindings, WORKER_NAME: "my_poplin" } as Bindings);

    expect([failed.status, (await failed.text()).includes("  ZONE: bad-worker. No hostname can start with the Worker's name")]).toEqual([503, true]);
  });
});

describe("the hosts of each kind of install, kept apart", () => {
  // Drift: a hostname of the free address answered by the other kind's rule. An install with a domain would serve its dashboard there before its login exists, and one without would answer every host as a setup page.
  test.each([
    { ...KINDS.domain, answers: [[302, "/setup", ""], [302, "/setup", ""], [302, "/setup", ""], [302, "/setup", ""]] },
    { ...KINDS.account, answers: [[401, null, null], [403, null, null], [404, null, "Not found\n"], [404, null, "Not found\n"]] },
  ])("on an install with $kind, the Worker's free address, the dashboard on it, and the two site hosts beside it answer by that kind's rule", async ({ bindings, answers }) => {
    const worker = instance(w);
    const asked = [`${FREE_ADMIN}/api/whoami`, `${FREE_ADMIN}/`, `${SITES}/api/whoami`, `${PRIVATE}/api/whoami`];
    const got: (readonly [number, string | null, string])[] = [];
    for (const address of asked) got.push(await told(await ask(worker, address, {}, bindings)));

    expect(got.map(([status, to, text], at) => [status, to, answers[at]?.[2] === null ? null : text])).toEqual(answers);
  });

  // Drift: the three hosts are three origins only while each answers its own part. The API or the dashboard's data on a site host would hand a site's script the admin's reach, and a site on the admin host would run as the dashboard.
  test("without a domain, the admin host answers the API, the dashboard, and no site; the site hosts answer sites and no path of the dashboard, with a token or a login or without", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const calls = callsOf(worker, token, KINDS.account);
    const open = await publish(worker, token, { name: "notes", access: "unlisted" }, [page("<p>notes</p>")], calls);
    const named = await publish(worker, token, { name: "docs", access: "public", public_name: "manual" }, [page("<p>docs</p>")], calls);
    const hidden = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")], calls);
    const owner = await accessHeaders(w);
    const both = { ...owner, Authorization: `Bearer ${token}` };

    const whoami = await calls.whoami.$get({ query: {} });
    const shell = await askFree(worker, `${FREE_ADMIN}/`, { headers: owner });
    const data = await askFree(worker, `${FREE_ADMIN}/data/sites`, { headers: owner });
    const setup = await askFree(worker, `${FREE_ADMIN}/setup`);
    const onAdmin = [await askFree(worker, `${FREE_ADMIN}/${open.label}/`), await askFree(worker, `${FREE_ADMIN}/manual/`), await askFree(worker, `${FREE_ADMIN}/${hidden.label}/`, { headers: owner })];
    const adminTexts = await Promise.all(onAdmin.map((answer) => answer.text()));
    const kept: (readonly [number, string | null, string])[] = [];
    for (const host of [SITES, PRIVATE]) {
      for (const path of ["/api/whoami", "/api/sites", "/data/sites", "/data/frame", "/login/", "/setup/", "/setup/api/check", "/"]) kept.push(await told(await askFree(worker, `${host}${path}`, { headers: both })));
    }
    // A first segment with no slash after it is sent to itself with one, as a site's is, and names no site there.
    const bare = [await told(await askFree(worker, `${SITES}/login`)), await told(await askFree(worker, `${PRIVATE}/login`))];
    const served = [await askFree(worker, open.addresses.site), await askFree(worker, named.addresses.public ?? ""), await askFree(worker, named.addresses.site), await askFree(worker, hidden.addresses.site, { headers: owner })];

    expect([open.addresses, named.addresses, hidden.addresses]).toEqual([
      { site: `${SITES}/${open.label}/`, public: null },
      { site: `${SITES}/${named.label}/`, public: `${SITES}/manual/` },
      { site: `${PRIVATE}/${hidden.label}/`, public: null },
    ]);
    expect({ status: whoami.status, body: await whoami.json() }).toMatchObject({ status: 200, body: { layout: { kind: "path", sites_host: "poplin-sites.example.workers.dev", private_host: "poplin-private.example.workers.dev" } } });
    expect([shell.status, shell.headers.get("Set-Cookie"), data.status, (await data.json<{ sites: Published[] }>()).sites.map((site) => site.label).sort()]).toEqual([200, null, 200, [open.label, named.label, hidden.label].sort()]);
    expect([setup.status, onAdmin.map((answer) => answer.status), adminTexts.filter((text) => /notes|docs|report<\/h1>/.test(text))]).toEqual([404, [403, 403, 200], []]);
    expect(kept).toEqual(kept.map(() => [404, null, "Not found\n"]));
    expect(bare).toEqual([[302, `${SITES}/login/`, ""], [404, null, "Not found\n"]]);
    expect(await Promise.all(served.map(told))).toEqual([[200, null, "<p>notes</p>"], [200, null, "<p>docs</p>"], [200, null, "<p>docs</p>"], [200, null, "<h1>report</h1>"]]);
  });

  const cameAround: readonly (readonly [string, (from: World) => Promise<Record<string, string>>])[] = [
    ["no token", async () => ({})],
    ["a token that is no token", async () => ({ "Cf-Access-Jwt-Assertion": "garbage" })],
    ["a token another key signed under the team's key id", async (from) => accessHeaders(from, {}, await signer("stranger-key"))],
    ["a token for an email that is not in the logins", (from) => accessHeaders(from, { email: "guest@example.com" })],
    ["a claim to be the owner in a header Access never sets", async () => ({ "Cf-Access-Authenticated-User-Email": OWNER })],
  ];

  // Drift: the private host is the letter p of this kind. A request that reached the Worker around the login would get a private file, or learn by a redirect or a query that a site exists.
  test.each(cameAround)("without a domain, on the private host, %s gets the one 404 for a private site, an unlisted one, and no site alike, and no call to the database or the bucket", async (_what, headers) => {
    const tally = { calls: 0 };
    const worker = instance(w);
    const counted = { ...countedBindings(tally), ZONE: KINDS.account.bindings.ZONE } as Bindings;
    await ask(worker, `${FREE_ADMIN}/api/whoami`, {}, counted);
    const token = await tokenOf(w, "publisher");
    const calls = callsOf(worker, token, KINDS.account);
    const hidden = await publish(worker, token, { name: "report" }, [page("<h1>report</h1>")], calls);
    const linked = await publish(worker, token, { name: "notes", access: "unlisted" }, [page("<p>notes</p>")], calls);
    const sent = await headers(w);
    await ask(worker, hidden.addresses.site, { headers: await accessHeaders(w) }, counted);

    tally.calls = 0;
    const answers: (readonly [number, string | null, string])[] = [];
    for (const label of [hidden.label, linked.label, `nobody--${NO_SITE}`, NO_SITE]) answers.push(await told(await ask(worker, `${PRIVATE}/${label}/`, { headers: sent }, counted)));

    expect({ answers, calls: tally.calls }).toEqual({ answers: answers.map(() => [404, null, "Not found\n"]), calls: 0 });
  });

  // Drift: a site is a path here, so its address moves by host and keeps the path after its first segment. A move that kept the whole path would name the site twice, and a label with no slash after it would resolve a page's own links outside the site.
  test("without a domain, an unlisted site made private moves to the private host with its path and query, a private one opened on the sites host moves back, and a label with no slash gains one", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const calls = callsOf(worker, token, KINDS.account);
    const site = await publish(worker, token, { name: "notes", access: "unlisted" }, [page("<p>notes</p>"), { path: "data/table.csv", body: new TextEncoder().encode("a,b\n"), type: "text/csv" }], calls);
    const owner = await accessHeaders(w);
    const bare = await told(await askFree(worker, `${SITES}/${site.label}?x=1`));
    const before = await told(await askFree(worker, `${PRIVATE}/${site.label}/data/table.csv?x=1`, { headers: owner }));
    const changed = await done<{ site: Published }>(await calls.sites[":site"].$patch({ param: { site: site.label }, query: {}, json: { access: "private" } }));
    const after = await told(await askFree(worker, `${SITES}/${site.label}/data/table.csv?x=1`));
    const byId = await told(await askFree(worker, `${SITES}/${site.id}/data/table.csv`));
    const file = await told(await askFree(worker, `${PRIVATE}/${site.label}/data/table.csv?x=1`, { headers: owner }));

    expect(changed.site.addresses.site).toBe(`${PRIVATE}/${site.label}/`);
    expect([bare, before, after, byId, file]).toEqual([
      [302, `${SITES}/${site.label}/?x=1`, ""],
      [302, `${SITES}/${site.label}/data/table.csv?x=1`, ""],
      [302, `${PRIVATE}/${site.label}/data/table.csv?x=1`, ""],
      [302, `${PRIVATE}/${site.id}/data/table.csv`, ""],
      [200, null, "a,b\n"],
    ]);
  });

  // Drift: on the private host a first segment in the form of an id is read as a site's id. A public name of that form would be an address that can never open, so no site may claim one.
  test.each([
    { ...KINDS.domain, status: 200, code: undefined },
    { ...KINDS.account, status: 400, code: "reserved_name" },
  ])("on an install with $kind, a public name in the form of a site's id is answered $status", async ({ status, code, ...at }) => {
    const worker = instance(w);
    const calls = callsOf(worker, await tokenOf(w, "publisher"), at);
    const file = { path: "index.html", size: 4, content_type: "text/html", sha256: await sha256Of(new TextEncoder().encode("docs")) };
    const begun = await calls.uploads.$post({ query: {}, json: { name: "docs", access: "public", public_name: "k3f9x2ab71qz", files: [file] } });

    expect([begun.status, ((await begun.json()) as { error?: { code: string } }).error?.code]).toEqual([status, code]);
  });
});

describe("what a request costs, by the kind of install", () => {
  // Drift: the kind is decided at the start, so it may add no query to a request. A lookup of the kind, or of a host, on every view would spend the day's rows on an install without a domain alone.
  test.each([KINDS.domain, KINDS.account])("on an install with $kind, a public page view on a warm instance costs one site query, one request count, and one file read, and a private one the same", async (at) => {
    const tally = { calls: 0 };
    const worker = instance(w);
    const counted = { ...countedBindings(tally), ZONE: at.bindings.ZONE } as Bindings;
    await ask(worker, `${at.admin}/api/whoami`, {}, counted);
    const calls = callsOf(worker, await tokenOf(w, "publisher"), at);
    const open = await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public", public_name: "manual" }, [page("<p>docs</p>")], calls);
    const hidden = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")], calls);
    const owner = await accessHeaders(w);
    const views = [{ address: `${new URL(open.addresses.public ?? "").href}`, headers: {} }, { address: `${new URL(hidden.addresses.site).href}`, headers: owner }];
    const costs: (readonly [number, number])[] = [];
    for (const view of views) {
      await ask(worker, view.address, { headers: view.headers }, counted);
      tally.calls = 0;
      const answer = await ask(worker, view.address, { headers: view.headers }, counted);
      costs.push([answer.status, tally.calls]);
    }

    expect(costs).toEqual([[200, 3], [200, 3]]);
  });
});

describe("the upload key, by the kind of install", () => {
  // Drift: the upload key is read once at the start, whatever the kind. Handed to one kind alone, an install without a domain would send every file through its Worker with a key that works, or one with a domain would.
  test.each([KINDS.domain, KINDS.account])("on an install with $kind, a begun publish is handed a ticket for the bucket where the Worker holds an upload key, and one of the install's own route where it holds none", async (at) => {
    const token = await tokenOf(w, "publisher");
    const file = page("<p>a page</p>");
    const files = [{ path: file.path, size: file.body.byteLength, content_type: file.type, sha256: await sha256Of(file.body) }];
    const secret = JSON.stringify({ id: "0123456789abcdef0123456789abcdef", secret: "5".repeat(64), bucket: "poplin-sites", minted_at: w.clock.now - 150_000 });
    const places: string[] = [];

    for (const [name, key] of [["report", secret], ["notes", undefined]] as const) {
      // An instance reads its secrets once, as it starts: each case is an instance of its own.
      const worker = instance(w);
      const calls = api(worker, token, (input, init) => ask(worker, input, init, { ...at.bindings, UPLOAD_KEY: key }), at.admin);
      const { tickets } = await done<{ tickets: { url: string }[] }>(await calls.uploads.$post({ query: {}, json: { name, files } }));
      places.push(...tickets.map((ticket) => (URL.canParse(ticket.url) ? new URL(ticket.url).host : ticket.url.split("/").slice(0, 3).join("/"))));
    }

    expect(places).toEqual([`${at.bindings.ACCOUNT_ID}.r2.cloudflarestorage.com`, "/api/uploads"]);
  });
});

describe("the screens of an install without a domain", () => {
  // Drift: the kind's words and its settings reach the screens through the one plug. Built from the other kind's, the dialog would say "the domain", a repair would be asked for settings it carries nowhere, and block_bots would look like it works.
  test("the Domain screen says there is no domain and names its runs by the install; Settings marks block_bots alone as needing a domain, and no setting for a repair", async () => {
    const worker = instance(w);
    const owner = await accessHeaders(w);
    const domain = await (await askFree(worker, `${FREE_ADMIN}/data/domain`, { headers: owner })).json<{ words: unknown; form: { tokenRights: string[] } }>();
    const { rows } = await (await askFree(worker, `${FREE_ADMIN}/data/settings`, { headers: owner })).json<{ rows: { key: string; repair: boolean; needs: string | null }[] }>();

    expect([domain.words, domain.form.tokenRights.length]).toEqual([{ thing: "the install", line: "No domain: your sites answer at Cloudflare's free address." }, 5]);
    expect([rows.filter((row) => row.repair), rows.filter((row) => row.needs !== null).map((row) => [row.key, row.needs])]).toEqual([[], [["block_bots", "Needs a domain."]]]);
  });
});

describe("a changed setting of the guard rules, by the kind of install", () => {
  // Drift: an install without a domain has no rule to write. A change left waiting there would wait for good: no run and no repair ever carries it.
  test.each([
    { ...KINDS.domain, waits: true },
    { ...KINDS.account, waits: false },
  ])("with $kind and no key, a saved outside_pages is left waiting only where a rule exists to write, and no problem is noted", async (kind) => {
    const calls = callsOf(instance(w), await tokenOf(w, "admin"), kind);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});

    await done(await calls.config.$patch({ query: {}, json: { outside_pages: "allowed" } }));
    const kept = await database.readDomainCheck();

    expect([kept === undefined ? "no run kept" : kept.rules_changed_at !== null, await problemsOf(w)]).toEqual([kind.waits, []]);
  });
});

describe("a database whose allowance for the day is used up, on an install without a domain", () => {
  // Drift: the paused answer is chosen by the admin host before any instance has started. Read by the other kind's rule, the API and the dashboard of this install would answer a site's paused page, which a cache may keep.
  test("the API answers its code, the dashboard its refusal, both site hosts the paused page, a site's file under /setup/api/ included, and the admin host's setup run its own refusal", async () => {
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = await tokenOf(w, "admin");
    const spent = { ...KINDS.account.bindings, DB: spentDatabase("read") } as Bindings;
    const worker = instance(w);
    const answers = [
      await ask(worker, `${FREE_ADMIN}/api/whoami`, { headers: { Authorization: `Bearer ${token}` } }, spent),
      await send(worker, `${FREE_ADMIN}/data/settings/sign-everyone-out`, {}, await accessHeaders(w), spent),
      await ask(worker, `${SITES}/manual/`, {}, spent),
      await ask(worker, `${PRIVATE}/report--${NO_SITE}/`, {}, spent),
      await ask(worker, `${SITES}/setup/api/check.html`, {}, spent),
      await ask(instance(w), `${FREE_ADMIN}/setup/api/check`, { method: "POST" }, spent),
    ];
    const whole = await Promise.all(answers.map(async (answer) => [answer.status, answer.headers.get("Cache-Control"), (await answer.text()).replace(/^\{.*"code":"(\w+)".*$/, "$1")]));

    expect(whole).toEqual([
      [503, "no-store", "allowance_spent"],
      [503, "no-store", "allowance_spent"],
      [503, "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "no-store", '{"ok":false,"refusal":"allowance_spent"}'],
    ]);
    expect(failed).toHaveBeenCalledTimes(6);
  });
});
