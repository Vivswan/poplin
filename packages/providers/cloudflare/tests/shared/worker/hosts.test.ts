// The one Worker started as each kind of install: with a domain, and on the account's free address with no domain.
// Without these the kind could be read in one place and forgotten in another: a site answered on the dashboard's hostname, or the API on a site's.

import { reset } from "cloudflare:test";
import { sha256Of } from "@poplin/core/src/storage/storage";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readShell } from "../../../../../app/tests/console/support/shell";
import type { Bindings } from "../../../src/shared/worker/bindings";
import { emptyAccount, KEPT, TOKEN } from "../install/support/fake-install";
import { markersIn, PLANTED, REFUSED_WORDS } from "../install/support/planted";
import type { Asked } from "../install/support/replies";
import { signer } from "../login/support/access";
import {
  ADMIN, type ApiCalls, accessHeaders, ask, api, BINDINGS, cloudflareOf, countedBindings, done, installOf, instance, logIn, OWNER, problemsOf,
  type Published, page, publish, send, spentDatabase, tokenOf, under, type Worker, type World, world,
} from "./support/install";

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

/** The bindings of an install whose `ACCESS` is not written yet. */
const UNFINISHED = { ...BINDINGS, ACCESS: undefined } as Bindings;

/** Every way the Worker's runtime prints a line. */
const PRINTS = ["log", "info", "warn", "error", "debug"] as const;

/** The runs of the Domain screen that write a failed row: what is sent, whether the install holds its key, and how a row of the run words what Cloudflare refused. */
const FAILED_RUNS = [
  { run: "a repair with a pasted token", path: "repair", body: { token: TOKEN }, keyed: false, says: REFUSED_WORDS },
  { run: "a check with a pasted token", path: "check", body: { token: TOKEN }, keyed: false, says: REFUSED_WORDS },
  { run: "a check with the key the install keeps", path: "check", body: {}, keyed: true, says: "the key the install holds lacks this permission" },
] as const;

/** A run that read its table, as the Domain screen is answered it. */
interface Ran {
  readonly ok: true;
  readonly summary: { readonly line: string; readonly tone: string };
}

/** Every row of every table of the database, as one text. */
async function stored(): Promise<string> {
  const tables = await BINDINGS.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").all<{ name: string }>();
  const rows = await Promise.all(tables.results.map(async ({ name }) => (await BINDINGS.DB.prepare(`SELECT * FROM "${name}"`).all()).results));

  return JSON.stringify(rows);
}

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
  // Drift: a hostname of the free address answered by the other kind's rule. An install with a domain would serve its dashboard there, where no login stands in front, and one without would answer nothing at its own address.
  test.each([
    { ...KINDS.domain, answers: [[404, null, "Not found\n"], [404, null, "Not found\n"], [404, null, "Not found\n"], [404, null, "Not found\n"]] },
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
    const onAdmin = [await askFree(worker, `${FREE_ADMIN}/${open.label}/`), await askFree(worker, `${FREE_ADMIN}/manual/`), await askFree(worker, `${FREE_ADMIN}/${hidden.label}/`, { headers: owner })];
    const adminTexts = await Promise.all(onAdmin.map((answer) => answer.text()));
    const kept: (readonly [number, string | null, string])[] = [];
    for (const host of [SITES, PRIVATE]) {
      for (const path of ["/api/whoami", "/api/sites", "/data/sites", "/data/frame", "/login/", "/"]) kept.push(await told(await askFree(worker, `${host}${path}`, { headers: both })));
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
    expect([onAdmin.map((answer) => answer.status), adminTexts.filter((text) => /notes|docs|report<\/h1>/.test(text))]).toEqual([[403, 403, 200], []]);
    expect(kept).toEqual(kept.map(() => [404, null, "Not found\n"]));
    expect(bare).toEqual([[302, `${SITES}/login/`, ""], [404, null, "Not found\n"]]);
    expect(await Promise.all(served.map(told))).toEqual([[200, null, "<p>notes</p>"], [200, null, "<p>docs</p>"], [200, null, "<p>docs</p>"], [200, null, "<h1>report</h1>"]]);
  });

  const cameAround: readonly (readonly [string, (from: World) => Promise<Record<string, string>>])[] = [
    ["no token", async () => ({})],
    ["a token that is no token", async () => ({ "Cf-Access-Jwt-Assertion": "garbage" })],
    ["a token another key signed under the team's key id", async (from) => accessHeaders(from, {}, await signer("stranger-key"))],
    ["a token for an email that is not in the users", (from) => accessHeaders(from, { email: "guest@example.com" })],
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

describe("the search of the Sites list, by the kind of install", () => {
  // Drift: the dashboard reads a pasted address with the layout the start hands it. Handed to one kind alone, or not at all, a link copied from the list would find nothing there; and a lookup made to read it would cost every search a query.
  test.each([KINDS.domain, KINDS.account])("on an install with $kind, a public and a private site's own address each find that one site, for the queries the whole list costs", async (at) => {
    const tally = { calls: 0 };
    const worker = instance(w);
    const counted = { ...countedBindings(tally), ZONE: at.bindings.ZONE } as Bindings;
    // The instance starts on the counted bindings, so every query after it is counted.
    await ask(worker, `${at.admin}/api/whoami`, {}, counted);
    const calls = callsOf(worker, await tokenOf(w, "publisher"), at);
    const open = await publish(worker, await tokenOf(w, "publisher"), { name: "docs", access: "public", public_name: "manual" }, [page("<p>docs</p>")], calls);
    const hidden = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")], calls);
    const owner = await accessHeaders(w);
    const found: (readonly [readonly string[], number])[] = [];
    for (const typed of ["", open.addresses.public ?? "", hidden.addresses.site, `${new URL(hidden.addresses.site).href}a/b.html?c=d`]) {
      tally.calls = 0;
      const answer = await ask(worker, `${at.admin}/data/sites?q=${encodeURIComponent(typed)}`, { headers: owner }, counted);
      const { sites } = await done<{ sites: readonly { name: string }[] }>(answer);
      found.push([sites.map((site) => site.name).sort(), tally.calls]);
    }
    const [[, whole] = [[], 0]] = found;

    expect([whole > 0, found]).toEqual([true, [[["docs", "report"], whole], [["docs"], whole], [["report"], whole], [["report"], whole]]]);
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
  test("the API answers its code, the dashboard its refusal, and both site hosts the paused page", async () => {
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = await tokenOf(w, "admin");
    const spent = { ...KINDS.account.bindings, DB: spentDatabase("read") } as Bindings;
    const worker = instance(w);
    const answers = [
      await ask(worker, `${FREE_ADMIN}/api/whoami`, { headers: { Authorization: `Bearer ${token}` } }, spent),
      await send(worker, `${FREE_ADMIN}/data/settings/sign-everyone-out`, {}, await accessHeaders(w), spent),
      await ask(worker, `${SITES}/manual/`, {}, spent),
      await ask(worker, `${PRIVATE}/report--${NO_SITE}/`, {}, spent),
    ];
    const whole = await Promise.all(answers.map(async (answer) => [answer.status, answer.headers.get("Cache-Control"), (await answer.text()).replace(/^\{.*"code":"(\w+)".*$/, "$1")]));

    expect(whole).toEqual([
      [503, "no-store", "allowance_spent"],
      [503, "no-store", "allowance_spent"],
      [503, "public, max-age=60", "This site is paused until midnight UTC.\n"],
      [503, "public, max-age=60", "This site is paused until midnight UTC.\n"],
    ]);
    // Each failure the entry answers is written twice: a line of text, then the error.
    expect(failed).toHaveBeenCalledTimes(8);
  });
});

describe("an install whose ACCESS is not written yet", () => {
  // Drift: an install whose login service was off when it was made runs without the variable until a repair writes it. One that started and admitted a token it has nothing to check with would let anyone in.
  test("keeps the dashboard and every private address shut, names the repair command, and lets the owner in once the variable is there", async () => {
    const unfinished = instance(w, cloudflareOf(emptyAccount(), []));
    const headers = await accessHeaders(w);
    const login = await ask(unfinished, `${ADMIN}/`, { headers }, UNFINISHED);
    const data = await ask(unfinished, `${ADMIN}/data/frame`, { headers }, UNFINISHED);

    const site = await publish(instance(w), await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    const shut = await ask(unfinished, `${under(site, "p")}/`, { headers }, UNFINISHED);
    const opened = await ask(instance(w), `${under(site, "p")}/`, { headers });
    // The helper throws unless the owner's first page is answered.
    await logIn(instance(w), w);

    expect([login.status, await login.text(), login.headers.get("Set-Cookie")]).toEqual([503, "The login is not set up yet. Run: npx poplin doctor --repair\n", null]);
    expect([data.status, ((await data.json()) as { code: string }).code]).toEqual([503, "login_not_set_up"]);
    expect([shut.status, (await shut.text()).includes("report"), opened.status, await opened.text()]).toEqual([404, false, 200, "<h1>report</h1>"]);
  });
});

describe("the Domain screen", () => {
  /** What the screen opens with, as far as these tests read it. */
  interface Opened {
    readonly form: { readonly tokenRights: readonly string[]; readonly tokenOptional: readonly { readonly right: string; readonly adds: string }[] };
  }

  // Drift: the screen is the only place a login added in Settings reaches Cloudflare's login from, and it was built and never mounted once before.
  test("is there for a logged-in admin with the token's rights, checks without a change, repairs with the pasted token, and is refused to anyone else", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const writes = (): string[] => asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);
    const worker = instance(w, cloudflareOf(account, asked));
    const session = await logIn(worker, w);
    const strangers = [await ask(worker, `${ADMIN}/domain`), await ask(worker, `${ADMIN}/data/domain`), await send(worker, `${ADMIN}/data/domain/repair`, { token: TOKEN })];
    const shell = await ask(worker, `${ADMIN}/domain`, { headers: session });
    const opened = await ask(worker, `${ADMIN}/data/domain`, { headers: session });
    const text = await opened.text();
    const { form } = JSON.parse(text) as Opened;
    const checked = await send(worker, `${ADMIN}/data/domain/check`, { token: TOKEN }, session);
    const none = writes();
    const repaired = await send(worker, `${ADMIN}/data/domain/repair`, { token: TOKEN }, session);

    expect(strangers.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([[403, null], [401, null], [401, null]]);
    expect([asked.length > 0, shell.status, ((await readShell(await shell.text())).boot as { domain: boolean }).domain]).toEqual([true, 200, true]);
    expect([form.tokenRights.includes("Workers Scripts: Edit"), form.tokenRights.includes("Zone Settings: Read")]).toEqual([true, true]);
    // Drift: the link carries nine rights, so a right the plug holds optional that the page listed among the needed ones sends a person back to adding it by hand.
    expect([form.tokenRights.includes("Zone WAF: Edit"), form.tokenOptional.find((optional) => optional.right === "Zone WAF: Edit")?.adds.startsWith("Cloudflare stops"), text.includes("by hand")]).toEqual([false, true, false]);
    expect([checked.status, (await checked.json<Ran>()).ok, none, repaired.status, (await repaired.json<Ran>()).summary.tone, account.applications.length, (await stored()).includes(TOKEN)]).toEqual([200, true, [], 200, "good", 2, false]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Drift: a failed row is kept in Activity for good and in the last check of the domain, and both are answered to every admin. A writer that lets Cloudflare's sentence into a row keeps the key, the id, the email and the hostname it quotes.
  describe.each([KINDS.domain, KINDS.account])("on an install with $kind, where Cloudflare refuses in a sentence that quotes private values", (at) => {
    test.each(FAILED_RUNS)("$run says each refusal in its own words everywhere it is kept or answered, and no value the sentence quotes is there or in the log", async ({ path, body, keyed, says }) => {
      const prints = PRINTS.map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
      const bindings = { ...at.bindings, ...(keyed ? { KEPT_KEY: KEPT } : {}) } as Bindings;
      const worker = instance(w, cloudflareOf({ ...emptyAccount(), ...PLANTED }, []));
      const session = await accessHeaders(w);
      const calls = api(worker, await tokenOf(w, "admin"), (input, init) => ask(worker, input, init, bindings), at.admin);
      const whole = async (answer: { readonly status: number; readonly headers: Headers; readonly text: () => Promise<string> }): Promise<string> => `${answer.status} ${JSON.stringify([...answer.headers])} ${await answer.text()}`;
      const sinks = [
        ["the answer of the run", await whole(await send(worker, `${at.admin}/data/domain/${path}`, body, session, bindings))],
        ["the Domain screen", await whole(await ask(worker, `${at.admin}/data/domain`, { headers: session }, bindings))],
        ["the Activity screen", await whole(await ask(worker, `${at.admin}/data/activity`, { headers: session }, bindings))],
        ["the API's last check", await whole(await calls.domain.$get({ query: {} }))],
        ["the API's Activity", await whole(await calls.audit.$get({ query: {} }))],
        ["the database", await stored()],
      ] as const;
      const logged = prints.flatMap((print) => print.mock.calls.flat().map((printed) => (printed instanceof Error ? `${printed.stack}` : JSON.stringify(printed))));

      expect(sinks.map(([sink, text]) => [sink, text.includes(says), markersIn(text)])).toEqual(sinks.map(([sink]) => [sink, true, []]));
      expect(markersIn(logged.join("\n"))).toEqual([]);
    });
  });
});
