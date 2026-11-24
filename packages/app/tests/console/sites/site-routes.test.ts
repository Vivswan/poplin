// The Sites screen's routes: what one site is answered with beside itself, and what a search of the list finds.

import { describe, expect, test } from "bun:test";

import { publishSite } from "@poplin/core/src/actions/publish/publish";
import { fileKey, sitePrefix } from "@poplin/core/src/actions/sites/files";

import { NOW } from "../../sites/support/install";
import { KINDS, LOGIN_HEADER } from "../support/install";
import { openConsole, openConsoleOf } from "../support/console";

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** A text longer than the listing looks for, and the title that holds it. */
const LONG_WORDS = "a title of more letters than the listing looks for";

/** What one page of the list answers, as far as these tests read it. */
interface Listed {
  readonly code?: string;
  readonly sites?: readonly { readonly name: string; readonly url: string; readonly id: string }[];
}

/** What a change of a site answers, as far as these tests read it. */
interface Changed {
  readonly code?: string;
  readonly about?: string | null;
  readonly sentence?: string;
  readonly site?: { readonly expires: unknown } | null;
}

/** What one folder of a site's files answers, or its refusal, as far as these tests read it. */
interface Folder {
  readonly code?: string;
  readonly about?: string | null;
  readonly sentence?: string;
  readonly files?: readonly { readonly path: string; readonly size: number }[];
  readonly next?: string | null;
}

// Drift: a public site's own switch for search engines would say "Saved." while the install keeps every search engine out, and nothing at the switch would say that it changes nothing.
test("one site is answered with whether the install lets search engines in: not as an install starts, and yes once that setting is on", async () => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "public");
  const allowed = async (): Promise<unknown> => ((await (await opened.get(`/data/sites/${site.name}--${site.id}`)).json()) as { readonly search_engines_allowed: unknown }).search_engines_allowed;

  const before = await allowed();
  await opened.change("/data/settings", { texts: { search_engines_allowed: "on" } });

  expect([before, await allowed()]).toEqual([false, true]);
});

// Drift: the question that makes a site public would show an address the client put together, and a name typed as a public link ends would get that ending twice with nothing said.
test("a public name is answered with the address the install gives it, which a site made public under that name then has; a name no site may hold has none", async () => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const asked = async (name: string): Promise<unknown> => (await opened.get(`/data/public-address?name=${name}`)).json();

  const told = (await asked("guide-page")) as { readonly address: string };
  const made = await opened.change(`/data/sites/${site.name}--${site.id}/access`, { access: "public", public_name: "guide-page" });
  const refusals = [await asked("Guide"), await asked("")].map((answer) => (answer as { readonly code: string }).code);

  expect([((await made.json()) as { readonly site: { readonly url: string } }).site.url, refusals]).toEqual([told.address, ["bad_name", "bad_name"]]);
});

// Drift: a span would be counted from some other moment than the save, a day would not start in UTC, a moment would be set late by the time its request took, or "never" would leave the old moment in place; and the log would not say who set it.
test.each([
  ["7d", NOW + 7 * DAY_MS],
  ["2023-12-01", Date.UTC(2023, 11, 1)],
  ["2023-12-01T08:30:00.250Z", Date.UTC(2023, 11, 1, 8, 30, 0, 250)],
  ["never", "never"],
])("a site's expiry set to %p is answered as the moment it ends, signed by the admin who asks", async (expires, moment) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  // An expiry is there first, so "never" is seen to take one away.
  await opened.change(`/data/sites/${site.name}--${site.id}/expiry`, { expires: "30d" });
  const response = await opened.change(`/data/sites/${site.name}--${site.id}/expiry`, { expires });
  const [last] = await opened.base.audit();

  expect([response.status, ((await response.json()) as Changed).site?.expires, last?.action, last?.by]).toEqual([200, moment, "details", opened.base.owner]);
});

// Drift: an expiry no rule takes would be stored, or refused with no word of the field it is about; one for a site in the trash would be set where nothing shows it.
test.each([
  ["a moment that is past", { expires: "2020-01-01" }, false, 400, "bad_argument", "expires"],
  ["a span in no known form", { expires: "soon" }, false, 400, "bad_argument", "expires"],
  ["no expiry at all", {}, false, 400, "bad_argument", "expires"],
  ["another setting beside it", { expires: "7d", name: "other" }, false, 400, "bad_argument", "name"],
  ["a site in the trash", { expires: "7d" }, true, 409, "in_trash", null],
])("a site's expiry is refused for %s, and stays as it was", async (_case, body, trashed, status, code, about) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = `${site.name}--${site.id}`;
  if (trashed) await opened.change(`/data/sites/${label}/delete`, {});

  const response = await opened.change(`/data/sites/${label}/expiry`, body);
  const refusal = (await response.json()) as Changed;
  const after = (await (await opened.get(`/data/sites/${label}`)).json()) as Changed;

  expect([response.status, refusal.code, refusal.about, after.site?.expires]).toEqual([status, code, about, "never"]);
  expect(refusal.sentence?.length).toBeGreaterThan(10);
});

// Drift: a site in the trash would stay with its files after it was deleted for good, or the log would not say who did it.
test("a site in the trash is deleted for good with its files, signed by the admin who asks", async () => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = `${site.name}--${site.id}`;
  const { store } = opened.base.install;
  const key = fileKey(site.folder, 1, "index.html");
  if (!key.ok) throw new Error("the test's own file has no key");

  await store.write(key.key, new TextEncoder().encode("<p>guide</p>"), { contentType: "text/html" });
  const held = (await store.list({ prefix: sitePrefix(site.folder), limit: 10 })).objects.length;
  await opened.change(`/data/sites/${label}/delete`, {});

  const response = await opened.change(`/data/sites/${label}/delete-for-good`, {});
  const [last] = await opened.base.audit();
  const kept = await store.list({ prefix: sitePrefix(site.folder), limit: 10 });

  expect([response.status, await response.json(), (await opened.get(`/data/sites/${label}`)).status]).toEqual([200, { ok: true, site: null }, 404]);
  expect([last?.action, last?.by, String(last?.site?.name), held, kept.objects.length]).toEqual(["delete", opened.base.owner, "guide", 1, 0]);
});

// Drift: one press on a live site would remove it with no way back: only a site that went to the trash first may go for good from the dashboard.
test.each([
  ["a site that is live", "guide", 409, "not_in_trash"],
  ["a site that is not there", "no-site--abcdefghijkl", 404, "not_found"],
  ["what is no label", "Not A Label!", 400, "bad_argument"],
])("deleting %s for good is refused, and the site stays", async (_case, reference, status, code) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = reference === "guide" ? `${site.name}--${site.id}` : reference;

  const response = await opened.change(`/data/sites/${encodeURIComponent(label)}/delete-for-good`, {});
  const refusal = (await response.json()) as Changed;

  expect([response.status, refusal.code, (await opened.get(`/data/sites/${site.name}--${site.id}`)).status]).toEqual([status, code, 200]);
  expect(refusal.sentence?.length).toBeGreaterThan(10);
});

// Drift: either change would be done for a request with no login, or for a body a page of another origin sends with the owner's login.
test.each([
  ["expiry", { expires: "7d" }],
  ["delete-for-good", {}],
])("%s is refused without a login and from another origin, and changes nothing", async (change, body) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = `${site.name}--${site.id}`;
  if (change === "delete-for-good") await opened.change(`/data/sites/${label}/delete`, {});
  const entries = (await opened.base.audit()).length;

  const loggedOut = await opened.change(`/data/sites/${label}/${change}`, body, { [LOGIN_HEADER]: "" });
  const elsewhere = await opened.change(`/data/sites/${label}/${change}`, body, { "Content-Type": "text/plain", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
  const after = (await (await opened.get(`/data/sites/${label}`)).json()) as Changed;

  expect([loggedOut.status, elsewhere.status, after.site?.expires, (await opened.base.audit()).length]).toEqual([401, 403, "never", entries]);
});

// Drift: the Link column shows a public site by its public name and its install's ending, and any other site by its id alone. A search that read no address would find nothing for what a person copies there, under one kind of install or under both.
describe.each([
  ["hostnames", KINDS.hostname, { elsewhere: (label: string) => `https://${label}-p-poplin.example.org/`, otherKind: (label: string) => `https://poplin-sites.example.net/${label}/` }],
  ["paths", KINDS.path, { elsewhere: (label: string) => `https://sites.example.org/${label}/`, otherKind: (label: string) => `https://${label}-p-poplin.example.org/` }],
] as const)("the list of an install whose sites are %s, searched for", (_kind, kind, { elsewhere, otherKind }) => {
  const stocked = async (): Promise<{ readonly found: (typed: string) => Promise<readonly string[] | string>; readonly links: Readonly<Record<string, string>>; readonly ids: Readonly<Record<string, string>> }> => {
    const opened = await openConsoleOf(kind);
    for (const [name, access] of [["guide", "private"], ["notes", "unlisted"], ["shelf", "public"], ["guide-two", "private"]] as const) await opened.base.publish(name, access);
    const shelf = (await opened.base.audit()).find((entry) => entry.site?.name === "shelf")?.site;
    await opened.change(`/data/sites/shelf--${shelf?.id}/access`, { access: "public", public_name: "open-shelf" });
    await opened.change(`/data/sites/guide-two--${(await opened.base.audit()).find((entry) => entry.site?.name === "guide-two")?.site?.id}/naming`, { title: LONG_WORDS });
    const asked = async (typed: string): Promise<Listed> => (await (await opened.get(`/data/sites?q=${encodeURIComponent(typed)}`)).json()) as Listed;
    const all = (await asked("")).sites ?? [];

    return {
      found: async (typed) => {
        const page = await asked(typed);

        return page.sites?.map((site) => site.name).sort() ?? page.code ?? "";
      },
      links: Object.fromEntries(all.map((site) => [site.name, site.url])),
      ids: Object.fromEntries(all.map((site) => [site.name, site.id])),
    };
  };

  test("a link, an address, a label or an id of one site: that site alone, whatever stands around the address", async () => {
    const { found, links, ids } = await stocked();
    const [guide = "", notes = "", shelf = ""] = [links.guide, links.notes, links.shelf];
    const typed = [
      guide,
      guide.replace("https://", ""),
      new URL("chapter/one.html?page=2#top", guide).href,
      ` <${guide}> `,
      guide.toUpperCase().replace("HTTPS://", "https://").replace(/\/GUIDE--[0-9A-Z]+\/$/, (path) => path.toLowerCase()),
      notes,
      shelf,
      shelf.replace("https://", "").replace(/\/$/, ""),
      `guide--${ids.guide}`,
      ids.guide ?? "",
      // The first label of each address: what the Link column shows of a site whose address is a hostname.
      new URL(guide).hostname.split(".")[0] ?? "",
      new URL(shelf).hostname.split(".")[0] ?? "",
      (new URL(shelf).hostname.split(".")[0] ?? "").toUpperCase(),
    ];
    const lists: (readonly string[] | string)[] = [];
    for (const text of typed) lists.push(await found(text));

    // Where a site is a path, the first label is the host's, which names no site.
    const byLabel = kind.layout.kind === "hostname" ? [["guide"], ["shelf"], ["shelf"]] : [[], [], []];

    expect(lists).toEqual([["guide"], ["guide"], ["guide"], ["guide"], ["guide"], ["notes"], ["shelf"], ["shelf"], ["guide"], ["guide"], ...byLabel]);
  });

  test("a text, as before: a name, a title, a public name, with capitals or cut to what the listing takes; and nothing for an address that is no site's here", async () => {
    const { found, links, ids } = await stocked();
    const label = `guide--${ids.guide}`;
    const typed = ["guide", "GUIDE", "open-sh", LONG_WORDS, `${LONG_WORDS} and more that no title holds`, "v1.2", elsewhere(label), otherKind(label), (links.guide ?? "").replace(ids.guide ?? "", "zzzzzzzzzzzz"), "x".repeat(2049)];
    const lists: (readonly string[] | string)[] = [];
    for (const text of typed) lists.push(await found(text));

    expect(lists).toEqual([["guide", "guide-two"], ["guide", "guide-two"], ["shelf"], ["guide-two"], ["guide-two"], [], [], [], [], "bad_argument"]);
  });
});

describe("one folder of a site's files", () => {
  /** A site whose one version holds a page, a folder in a folder, and a folder of one file more than a page of the route holds: 204 files, each holding its own path. Answers the address of its files. */
  async function stocked(opened: Awaited<ReturnType<typeof openConsole>>): Promise<string> {
    const many = Array.from({ length: 201 }, (_unused, at) => `many/file-${String(at).padStart(3, "0")}.txt`);
    const files = ["index.html", "docs/a.html", "docs/deep/b.html", ...many].map((path) => {
      const bytes = new TextEncoder().encode(path);

      return { path, size: bytes.length, contentType: "text/plain", open: () => new Blob([bytes]).stream() };
    });
    const published = await publishSite(opened.base.install, { scope: "admin", holder: opened.base.owner }, { name: "guide", files });
    if (!published.ok) throw new Error(`the test's site was refused: ${published.code}`);

    return `/data/sites/${published.site.label}/files`;
  }

  // Drift: the panel's tree asks for one folder with each press; a route that answered what lies in a folder's folders, named a folder by another path than the next press asks it by,
  // or gave a page no end would list the storage for nothing, and show a tree no press goes on in.
  test("is answered with the folders and the files right in it, by their paths in the version, 200 a page with the cursor of the page after it", async () => {
    const opened = await openConsole();
    const files = await stocked(opened);
    const folder = async (query: string): Promise<Folder> => (await (await opened.get(`${files}?${query}`)).json()) as Folder;

    const first = await folder("version=1&folder=many");
    const second = await folder(`version=1&folder=many&cursor=${encodeURIComponent(first.next ?? "")}`);

    expect<unknown>([await folder("version=1"), await folder("version=1&folder=docs"), await folder("version=1&folder=docs%2Fdeep")]).toEqual([
      { ok: true, folders: ["docs", "many"], files: [{ path: "index.html", size: 10 }], next: null, total: 204 },
      { ok: true, folders: ["docs/deep"], files: [{ path: "docs/a.html", size: 11 }], next: null, total: 204 },
      { ok: true, folders: [], files: [{ path: "docs/deep/b.html", size: 16 }], next: null, total: 204 },
    ]);
    expect([first.files?.length, first.files?.at(-1)?.path, typeof first.next, second.files, second.next]).toEqual([200, "many/file-199.txt", "string", [{ path: "many/file-200.txt", size: 17 }], null]);
  });

  // Drift: what names a folder is typed into an address; a version the site does not keep, or a path that leaves the version, would be listed as if it were the site's.
  test.each([
    ["a version the site does not keep", "version=2", 404, "no_such_version", null],
    ["no version", "folder=docs", 400, "bad_argument", "version"],
    ["a version that is no number", "version=live", 400, "bad_argument", "version"],
    ["a folder that climbs out of the version", "version=1&folder=..%2Fv2", 400, "bad_argument", "folder"],
  ])("is refused for %s", async (_what, query, status, code, about) => {
    const opened = await openConsole();
    const response = await opened.get(`${await stocked(opened)}?${query}`);
    const refusal = (await response.json()) as Folder;

    expect([response.status, refusal.code, refusal.about]).toEqual([status, code, about]);
  });

  // Drift: the panel keeps the pages it read while the dashboard stays open; a cursor that outlived its listing would be answered with rows of another, or in words that name no way on: the row that reads on sends the same cursor again.
  test("is refused for the cursor of another folder's page, in a sentence that says to load the page again", async () => {
    const opened = await openConsole();
    const files = await stocked(opened);
    const first = (await (await opened.get(`${files}?version=1&folder=many`)).json()) as Folder;
    const response = await opened.get(`${files}?version=1&folder=docs&cursor=${encodeURIComponent(first.next ?? "")}`);
    const refusal = (await response.json()) as Folder;

    expect([typeof first.next, response.status, refusal.code, refusal.about, refusal.sentence?.includes("Load the page again")]).toEqual(["string", 400, "bad_argument", "cursor", true]);
  });
});
