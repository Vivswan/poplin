// The Activity screen's routes: which entries a page holds under each narrowing, what each entry says of its site and its token, how a page goes on and back in either order, how many entries the log is said to hold, and the file the log is saved as.

import { describe, expect, test } from "bun:test";

import { deleteSite } from "@poplin/core/src/actions/delete";
import { issueToken } from "@poplin/core/src/actions/manage-tokens";
import { updateSite } from "@poplin/core/src/actions/set";
import { siteLabel } from "@poplin/core/src/sites/labels";

import { openConsole } from "./support/console";

/** What the route answers. */
interface Page {
  readonly entries: readonly {
    readonly seq: number;
    readonly by: string;
    readonly action: string;
    readonly site: { readonly name: string; readonly label: string | null } | null;
  }[];
  readonly logins: Readonly<Record<string, string>>;
  readonly next: string | null;
  readonly previous: string | null;
}

/** An install with a renamed site, a site deleted for good, and a named token: one entry of each kind of site, and one of access. */
async function openWithHistory(): Promise<{ readonly opened: Awaited<ReturnType<typeof openConsole>>; readonly keptLabel: string; readonly token: string }> {
  const opened = await openConsole();
  const { install, owner, publish } = opened.base;
  const actor = { scope: "admin", holder: owner } as const;
  const kept = await publish("field-notes");
  const gone = await publish("old-draft");
  await updateSite(install, actor, { site: kept.id, name: "trip-notes" });
  await deleteSite(install, actor, { site: gone.id, forever: true });
  const issued = await issueToken(install, actor, { scope: "publisher", note: "the laptop" });
  if (!issued.ok) throw new Error("the test token was refused");

  return { opened, keptLabel: siteLabel("trip-notes" as typeof kept.name, kept.id), token: issued.record.id };
}

async function pageOf(opened: Awaited<ReturnType<typeof openConsole>>, query = ""): Promise<Page> {
  return (await (await opened.get(`/data/activity${query}`)).json()) as Page;
}

describe("a page of the log", () => {
  // Drift: a filter would keep the wrong actions, or a search by site would miss a site under the name it had then.
  test.each([
    ["", ["token_added", "delete", "details", "create", "create", "settings_set"]],
    ["?kind=sites", ["delete", "details", "create", "create"]],
    ["?kind=access", ["token_added"]],
    ["?kind=settings", ["settings_set"]],
    ["?site=field", ["create"]],
    ["?site=notes", ["details", "create"]],
    ["?kind=access&site=notes", []],
  ])("under %s holds the entries of that narrowing, the newest first", async (query, actions) => {
    const { opened } = await openWithHistory();
    const page = await pageOf(opened, query);

    expect(page.entries.map((entry) => entry.action)).toEqual(actions);
  });

  // Drift: a site that is gone would be linked to a page that answers 404, or a renamed one to the label it no longer has.
  test("names each site as it was then, with the label it has now, and none for a site that is gone", async () => {
    const { opened, keptLabel } = await openWithHistory();
    const page = await pageOf(opened, "?kind=sites");

    expect(page.entries.map((entry) => entry.site)).toEqual([
      { name: "old-draft", label: null },
      { name: "trip-notes", label: keptLabel },
      { name: "old-draft", label: null },
      { name: "field-notes", label: keptLabel },
    ]);
  });

  // Drift: one screen would write a login by its name and another by its id: the log, the Sites table, and a site's panel answer the same names.
  test("gives the name of each login that has one, by the login's id, as the Sites table and a site do", async () => {
    const { opened, keptLabel, token } = await openWithHistory();
    const answers = await Promise.all(["/data/activity", "/data/sites", `/data/sites/${keptLabel}`].map(async (path) => (await opened.get(path)).json()));

    expect(answers.map((answer) => (answer as Page).logins)).toEqual(Array.from({ length: 3 }, () => ({ [token]: "the laptop" })));
  });

  // Drift: a second page would repeat or skip entries, go on against the order it is read in, or a last page would offer a page after it.
  test.each([
    ["", "the newest first", (left: number, right: number) => right - left],
    ["dir=desc", "the newest first", (left: number, right: number) => right - left],
    ["dir=asc", "the oldest first", (left: number, right: number) => left - right],
  ])("under %p goes on %s: a full page ends with the place the next one starts after, and a short one with none", async (order, _words, inOrder) => {
    const opened = await openConsole();
    const { install, owner, clock } = opened.base;
    for (let count = 0; count < 59; count += 1) await install.database.appendAudit({ action: "login", detail: {} }, { by: owner, at: clock.now });

    const first = await pageOf(opened, `?${order}`);
    const second = await pageOf(opened, `?${order}&after=${first.next}`);
    const seqs = [...first.entries, ...second.entries].map((entry) => entry.seq);

    expect([first.entries.length, second.entries.length, second.next]).toEqual([50, 10, null]);
    expect(seqs).toEqual([...seqs].sort(inOrder));
    expect(new Set(seqs).size).toBe(60);
  });

  // Drift: a log of exactly one page would offer a next page that holds nothing.
  test("offers no next page when the entries end with the page", async () => {
    const opened = await openConsole();
    const { install, owner, clock } = opened.base;
    for (let count = 0; count < 49; count += 1) await install.database.appendAudit({ action: "login", detail: {} }, { by: owner, at: clock.now });

    const page = await pageOf(opened);

    expect([page.entries.length, page.next]).toEqual([50, null]);
  });

  // Drift: a crafted address would reach the database with a place or a kind it does not know, or the refusal would repeat the value.
  test.each([
    ["?after=soon", "after"],
    ["?after=0", "after"],
    ["?back=soon", "back"],
    ["?after=3&back=9", "back"],
    ["?size=500", "size"],
    ["?size=51", "size"],
    ["?dir=up", "dir"],
    ["?kind=everything", "kind"],
    [`?site=${"a".repeat(41)}`, "site"],
  ])("refuses %s by the key alone", async (query, about) => {
    const opened = await openConsole();
    const response = await opened.get(`/data/activity${query}`);

    expect([response.status, await response.json()]).toEqual([
      400,
      { ok: false, code: "bad_argument", about, sentence: `The value of ${about} is not one it takes.` },
    ]);
  });
});

describe("the pages around a page of the log", () => {
  // Drift: a page gone back to would repeat or skip entries, come out against the order of the list, or offer a page ahead of the first; a larger page would be cut at what one reading of the log answers.
  test.each([
    ["", 50, (left: number, right: number) => right - left],
    ["dir=asc", 50, (left: number, right: number) => left - right],
    ["size=100", 100, (left: number, right: number) => right - left],
    ["size=200", 200, (left: number, right: number) => right - left],
  ])("under %p, %d entries a page: going on and then back shows the same pages, and only the first has none ahead of it", async (query, size, inOrder) => {
    const opened = await openConsole();
    const { install, owner, clock } = opened.base;
    for (let count = 0; count < size * 2 + 9; count += 1) await install.database.appendAudit({ action: "login", detail: {} }, { by: owner, at: clock.now });

    const first = await pageOf(opened, `?${query}`);
    const second = await pageOf(opened, `?${query}&after=${first.next}`);
    const third = await pageOf(opened, `?${query}&after=${second.next}`);
    const secondAgain = await pageOf(opened, `?${query}&back=${third.previous}`);
    const firstAgain = await pageOf(opened, `?${query}&back=${secondAgain.previous}`);
    const seqs = [first, second, third].flatMap((page) => page.entries.map((entry) => entry.seq));

    expect([first, second, third].map((page) => page.entries.length)).toEqual([size, size, 10]);
    expect(seqs).toEqual([...seqs].sort(inOrder));
    expect(new Set(seqs).size).toBe(size * 2 + 10);
    expect([first.previous, third.next, firstAgain.previous]).toEqual([null, null, null]);
    expect([secondAgain, firstAgain]).toEqual([second, { ...first, next: first.next }]);
  });

  // Drift: a page gone back to under a filter would count the entries the filter leaves out, and show a short page or one from another kind.
  test("going back keeps the narrowing", async () => {
    const { opened } = await openWithHistory();
    const all = await pageOf(opened, "?kind=sites");
    const last = all.entries.at(-1);
    const back = await pageOf(opened, `?kind=sites&back=${last?.seq}`);

    expect([back.entries.map((entry) => entry.action), back.next, back.previous]).toEqual([["delete", "details", "create"], String(all.entries.at(-2)?.seq), null]);
  });
});

describe("the total of the log", () => {
  // Drift: the foot would say a total of the whole log over a narrowed list, or the route would take a key the count does not know.
  test.each([
    ["", { ok: true, total: 6, whole: true }, 200],
    ["?kind=sites", { ok: true, total: 4, whole: true }, 200],
    ["?site=notes", { ok: true, total: 2, whole: true }, 200],
    ["?kind=access&site=notes", { ok: true, total: 0, whole: true }, 200],
    ["?kind=everything", { ok: false, code: "bad_argument", about: "kind", sentence: "The value of kind is not one it takes." }, 400],
    ["?after=3", { ok: false, code: "bad_argument", about: "after", sentence: "The value of after is not one it takes." }, 400],
  ])("under %p is %j", async (query, answer, status) => {
    const { opened } = await openWithHistory();
    const response = await opened.get(`/data/activity/total${query}`);

    expect([response.status, await response.json()]).toEqual([status, answer]);
  });

  // Drift: the count is of the install's whole history; without a session it would tell a stranger how busy the install is.
  test("is answered to nobody without a session", async () => {
    const opened = await openConsole();

    expect((await opened.getLoggedOut("/data/activity/total")).status).toBe(401);
  });
});

/** Append logins to an install's log until it holds as many entries; an opened install holds one already. */
async function fillLog(opened: Awaited<ReturnType<typeof openConsole>>, entries: number): Promise<void> {
  const { install, owner, clock } = opened.base;
  for (let count = 1; count < entries; count += 1) await install.database.appendAudit({ action: "login", detail: {} }, { by: owner, at: clock.now });
}

describe("the log as a file", () => {
  // Drift: the file would hold other entries than the screen's filters show, name a token by its id where the screen names it by its note, or say something else was done than the screen says.
  test.each([
    ["?kind=access", ['"Added the token ""the laptop""",,token_added']],
    ["?site=notes", ["Changed the site's settings,trip-notes,details", "Made the site,field-notes,create"]],
    ["?kind=access&site=notes", []],
  ])("under %p holds a heading and the entries of that narrowing, the newest first, in the screen's words", async (query, ends) => {
    const { opened } = await openWithHistory();
    const { owner, clock } = opened.base;
    const response = await opened.get(`/data/activity/download${query}`);
    const when = new Date(clock.now).toISOString();

    expect([response.status, await response.text()]).toEqual([200, ["When (UTC),Who,What,Site,Action", ...ends.map((end) => `${when},${owner},${end}`), ""].join("\r\n")]);
  });

  // Drift: a browser would show the file instead of saving it, save it under a name with no date or the wrong ending, or keep a copy of the log in its cache.
  test.each([
    ["", "text/csv; charset=utf-8", "csv"],
    ["?format=csv", "text/csv; charset=utf-8", "csv"],
    ["?format=jsonl", "application/jsonl; charset=utf-8", "jsonl"],
  ])("under %p is answered as a file to save, named by the day, and kept by no cache", async (query, type, ending) => {
    const opened = await openConsole();
    const response = await opened.get(`/data/activity/download${query}`);
    const day = new Date(opened.base.clock.now).toISOString().slice(0, 10);

    expect([response.headers.get("Content-Type"), response.headers.get("Content-Disposition"), response.headers.get("Cache-Control")]).toEqual([type, `attachment; filename="poplin-activity-${day}.${ending}"`, "no-store"]);
  });

  // Drift: a line of the JSON file would lose what the action set, which only this format holds.
  test("as one JSON object a line holds what each action set", async () => {
    const { opened, token } = await openWithHistory();
    const lines = (await (await opened.get("/data/activity/download?format=jsonl&kind=access")).text()).split("\n");

    expect([lines.length, JSON.parse(lines[0] ?? "null")]).toEqual([
      2,
      { when: new Date(opened.base.clock.now).toISOString(), who: opened.base.owner, what: 'Added the token "the laptop"', site: "", action: "token_added", detail: { token, scope: "publisher", note: "the laptop" } },
    ]);
  });

  // Drift: a file would grow with the log, in rows read and in the time one request is given, or be cut without a word, so that a reader takes it for the whole log.
  test.each([
    [2000, "settings_set", null],
    [2001, "2,000 entries. The log holds more: download the next part.", "2"],
  ])("of a log of %d entries holds 2,000 of them, and its last line and the place after it say whether the log holds more", async (entries, last, after) => {
    const opened = await openConsole();
    await fillLog(opened, entries);
    const text = (await (await opened.get("/data/activity/download?format=jsonl")).text()).trimEnd().split("\n");
    const said = JSON.parse(text.at(-1) ?? "null") as { readonly note?: string; readonly action?: string };
    const next = await (await opened.get("/data/activity/download/next")).json();

    expect([text.slice(0, 2000).length, said.note ?? said.action, next]).toEqual([2000, last, { ok: true, after }]);
  });

  // Drift: a file cut by a failure would end like a whole one, and be read as the whole log; a browser reports a failed download only when the answer breaks off.
  test("breaks off with an error when a reading after the first fails, instead of ending as a whole file", async () => {
    const opened = await openConsole();
    await fillLog(opened, 1501);
    const { database } = opened.base.install;
    const read = database.listAudit.bind(database);
    const readings = { count: 0 };
    database.listAudit = async (query) => {
      readings.count += 1;
      if (readings.count > 1) throw new Error("the database is away");

      return read(query);
    };
    const response = await opened.get("/data/activity/download");

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("the database is away");
  });

  // Drift: a long log could not be saved whole: the second file would repeat the first one's entries or skip some, or two files of a day would be saved under one name.
  test("of a long log goes on in a second file from the place the first ended, each named by its number, and the last says nothing of more", async () => {
    const opened = await openConsole();
    await fillLog(opened, 2501);
    const day = new Date(opened.base.clock.now).toISOString().slice(0, 10);
    const { after } = (await (await opened.get("/data/activity/download/next?kind=access")).json()) as { readonly after: string };
    const files = [await opened.get("/data/activity/download?kind=access&format=jsonl&part=1"), await opened.get(`/data/activity/download?kind=access&format=jsonl&part=2&after=${after}`)];
    const lines = await Promise.all(files.map(async (file) => (await file.text()).trimEnd().split("\n")));
    const end = await (await opened.get(`/data/activity/download/next?kind=access&after=${after}`)).json();

    expect(files.map((file) => file.headers.get("Content-Disposition"))).toEqual([1, 2].map((part) => `attachment; filename="poplin-activity-${day}-${part}.jsonl"`));
    expect([lines.map((file) => file.length), lines[0]?.at(-1), end]).toEqual([[2001, 500], '{"note":"2,000 entries. The log holds more: download the next part."}', { ok: true, after: null }]);
  });

  // Drift: a crafted address would reach the log with a key it does not know, or the file would be read in an order its bound is not said for.
  test.each([
    ["?format=xml", "format"],
    ["?after=soon", "after"],
    ["?part=0", "part"],
    ["?dir=asc", "dir"],
    ["?kind=everything", "kind"],
    ["/next?format=csv", "format"],
    ["/next?after=0", "after"],
  ])("refuses %s by the key alone", async (query, about) => {
    const opened = await openConsole();
    const response = await opened.get(`/data/activity/download${query}`);

    expect([response.status, await response.json()]).toEqual([400, { ok: false, code: "bad_argument", about, sentence: `The value of ${about} is not one it takes.` }]);
  });

  // Drift: the file is the install's whole history; without a session it would be handed to anyone who knows the address.
  test("is answered to nobody without a session, nor is the place a file ends", async () => {
    const opened = await openConsole();

    expect([(await opened.getLoggedOut("/data/activity/download")).status, (await opened.getLoggedOut("/data/activity/download/next")).status]).toEqual([401, 401]);
  });
});
