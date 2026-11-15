// The Activity screen's routes: which entries a page holds under each narrowing, what each entry says of its site and its token, how a page goes on and back in either order, and how many entries the log is said to hold.

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
