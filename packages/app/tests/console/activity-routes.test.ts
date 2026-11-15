// The Activity screen's route: which entries a page holds under each narrowing, what each entry says of its site and its token, and how a page goes on in either order.

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
