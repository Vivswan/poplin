// The copy routes of the Sites screen: what each request of a copy answers, what it costs, and what a cancelled copy leaves.

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { deleteSite } from "@poplin/core/src/actions/delete";
import type { Job, Jobs } from "@poplin/core/src/jobs/jobs";
import { runJob } from "@poplin/core/src/jobs/run-job";
import { publishSite } from "@poplin/core/src/actions/publish";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import { BunSqliteDriver } from "@poplin/core/tests/database/support/bun-sqlite-driver";

import { openConsole } from "./support/console";
import { LOGIN_HEADER } from "./support/install";

/** The most calls to the database one request of a copy may make here: the 44 a copy is held to, less a host's start of 2 and its 2 for counting the day's listings, which no test install makes. The test console's session costs 2 calls, a host's 1. */
const MOST_DATABASE_CALLS = 40;

/** The most calls to the store one request of a copy may make. */
const MOST_STORE_CALLS = 250;

/** How long a test that copies a thousand files may take, in milliseconds: it passes alone in under a second, and a busy machine takes it past the runner's five. */
const COPY_MS = 30_000;

/** Every call of the store that a host counts. */
const STORE_CALLS = ["head", "read", "write", "delete", "deleteMany", "list"] as const;

/** A console the tests ask. */
type Opened = Awaited<ReturnType<typeof openConsole>>;

/** What a route answers, read loosely: each test names the keys it holds. */
interface Answer {
  readonly status: number;
  readonly site: { readonly id: string; readonly name: string; readonly access: string } | null;
  readonly copy: { readonly upload: string; readonly copied: number | null; readonly files: number };
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
}

/** Publish a site of `count` small files as the owner, and answer its label. */
async function publish(opened: Opened, name: string, count: number): Promise<string> {
  const files = Array.from({ length: count }, (_page, at) => ({ path: at === 0 ? "index.html" : `pages/${at}.html`, size: 1, contentType: "text/html", open: () => new Blob(["x"]).stream() }));
  const made = await publishSite(opened.base.install, { scope: "admin", holder: opened.base.owner }, { name, files, access: "unlisted" });
  if (!made.ok) throw new Error(`the source was refused: ${made.code}`);

  return `${made.site.name}--${made.site.id}`;
}

/** Send one request of a copy, and answer its status with its body. */
async function ask(opened: Opened, path: string, body: unknown = {}): Promise<Answer> {
  const response = await opened.change(`/data${path}`, body);

  return { status: response.status, ...((await response.json()) as Omit<Answer, "status">) };
}

/** The names of the sites the table lists, by name: the test clock stands still, so the table's own order of two sites is by their ids. */
async function listed(opened: Opened): Promise<readonly string[]> {
  const page = (await (await opened.get("/data/sites")).json()) as { readonly sites: readonly { readonly name: string; readonly access: string }[] };

  return page.sites.map((site) => `${site.name} ${site.access}`).sort();
}

/** Count every call to the database and to the store from now on: each asking answers the calls since the one before. */
function countCalls(): () => { readonly database: number; readonly store: number } {
  const spies = { database: spyOn(BunSqliteDriver.prototype, "batch"), store: STORE_CALLS.map((call) => spyOn(MemoryStore.prototype, call)) };
  const before = { database: 0, store: 0 };

  return () => {
    const total = { database: spies.database.mock.calls.length, store: spies.store.reduce((sum, spy) => sum + spy.mock.calls.length, 0) };
    const spent = { database: total.database - before.database, store: total.store - before.store };
    Object.assign(before, total);

    return spent;
  };
}

afterEach(() => mock.restore());

describe("a copy of a site", () => {
  // Drift: a copy made by one long request is ended by a host that bounds a request, and a copy listed before its last file is one a person opens half made.
  test("of 300 files is made by three requests of 112 files each at most, and is a private site in the list only after the last, with one entry in the activity", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "report", 300);
    const rounds: Answer[] = [];
    const lists: (readonly string[])[] = [];

    for (let upload: string | undefined; rounds.at(-1)?.site == null; upload = rounds.at(-1)?.copy.upload) {
      rounds.push(await ask(opened, `/sites/${source}/duplicate`, upload === undefined ? { name: "report-two" } : { upload }));
      lists.push(await listed(opened));
    }

    expect(rounds.map((round) => [round.status, round.copy.copied, round.copy.files, round.site?.access ?? null])).toEqual([
      [200, 112, 300, null],
      [200, 224, 300, null],
      [200, 300, 300, "private"],
    ]);
    expect(lists).toEqual([["report unlisted"], ["report unlisted"], ["report unlisted", "report-two private"]]);
    expect((await opened.base.audit()).filter((entry) => entry.action === "duplicate").map((entry) => entry.by)).toEqual([opened.base.owner]);
  });

  // Drift: the console reads the session before the action runs, which the action does not see: told nothing of it, a request would pass what a host lets one make of the database.
  test.each([
    [40, 1],
    [300, 3],
    [1_001, 10],
  ])("of %i files takes %i requests, none of which makes more than 40 calls to the database, the session's included, or more than 250 to the store", async (count, requests) => {
    const opened = await openConsole();
    await opened.change("/data/settings", { texts: { max_files_per_publish: "10000" } });
    const source = await publish(opened, "report", count);
    const spent = countCalls();
    const costs: ReturnType<typeof spent>[] = [];

    for (let round = await ask(opened, `/sites/${source}/duplicate`); ; round = await ask(opened, `/sites/${source}/duplicate`, { upload: round.copy.upload })) {
      costs.push(spent());
      if (round.site !== null) break;
    }

    expect([costs.length, costs.filter((cost) => cost.database > MOST_DATABASE_CALLS || cost.store > MOST_STORE_CALLS)]).toEqual([requests, []]);
  }, COPY_MS);

  // Drift: a small site would wait on a second request that copies nothing, where the first can answer the site.
  test("of 3 files is a site at the first request, under the source's name when none is sent", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "notes", 3);

    const copied = await ask(opened, `/sites/${source}/duplicate`);

    expect([copied.status, copied.site?.name, copied.site?.access, copied.copy.copied]).toEqual([200, "notes", "private", 3]);
    expect(copied.site?.id).not.toBe(source.split("--")[1]);
  });

  // Drift: a refusal would reach the dialog as a status alone, with no word of what to change, or name the wrong field.
  test("is refused in the action's own words: a name that breaks the rules at the name, a site in the trash, a full install, an upload that is none, and a request that names both", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "report", 3);
    const binned = await publish(opened, "old", 3);
    await deleteSite(opened.base.install, { scope: "admin", holder: opened.base.owner }, { site: binned });

    const named = await ask(opened, `/sites/${source}/duplicate`, { name: "Not A Name" });
    const trashed = await ask(opened, `/sites/${binned}/duplicate`);
    const unknown = await ask(opened, `/sites/${source}/duplicate`, { upload: "0000000000000000" });
    const both = await ask(opened, `/sites/${source}/duplicate`, { name: "report-two", upload: "0000000000000000" });
    const more = await ask(opened, `/sites/${source}/duplicate`, { files: 3 });
    await opened.change("/data/settings", { texts: { max_sites: "2" } });
    const full = await ask(opened, `/sites/${source}/duplicate`);

    expect([named, trashed, unknown, both, more, full].map((answer) => [answer.status, answer.code, answer.about])).toEqual([
      [400, "bad_name", "name"],
      [409, "in_trash", null],
      [404, "not_found", "upload"],
      [400, "bad_argument", "name"],
      [400, "bad_argument", "files"],
      [409, "too_many_sites", "max_sites"],
    ]);
    expect([named.sentence, full.sentence]).toEqual([
      "The name breaks the rules: 3 to 40 characters, lowercase letters, digits, and single dashes inside.",
      "The install holds as many sites as it may, so no copy was made.",
    ]);
    expect(await listed(opened)).toEqual(["report unlisted"]);
  });

  // Drift: a source deleted for good while its copy is made would leave the dialog asking for ever, or a half copy in the list.
  test("whose source is gone before the next request is refused there, and no site is made", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "report", 300);
    const begun = await ask(opened, `/sites/${source}/duplicate`);
    await deleteSite(opened.base.install, { scope: "admin", holder: opened.base.owner }, { site: source, forever: true });

    const next = await ask(opened, `/sites/${source}/duplicate`, { upload: begun.copy.upload });

    expect([next.status, next.code, await listed(opened)]).toEqual([404, "not_found", []]);
  });
});

describe("a copy on a host that runs jobs", () => {
  // Drift: the routes hand the host's jobs to the action; a console built with them that still copied in each request would copy every file twice, beside the job, and one that never started the job would wait for ever.
  test("of 300 files starts one job at the first request, is asked after without a call to the store while the job runs, is a site once the job's rounds are done, and a Cancel stops the job", async () => {
    const started: Job[] = [];
    const stopped: Job[] = [];
    const jobs: Jobs = { background: true, start: async (job) => void started.push(job), stop: async (job) => void stopped.push(job) };
    const opened = await openConsole("", undefined, undefined, undefined, undefined, jobs);
    const source = await publish(opened, "report", 300);

    const begun = await ask(opened, `/sites/${source}/duplicate`, { name: "report-two" });
    const spent = countCalls();
    const waiting = await ask(opened, `/sites/${source}/duplicate`, { upload: begun.copy.upload });
    const cost = spent();
    const [job] = started;
    if (job === undefined) throw new Error("no job was started");

    const rounds = [await runJob(opened.base.install, job), await runJob(opened.base.install, job)];
    const made = await ask(opened, `/sites/${source}/duplicate`, { upload: begun.copy.upload });
    const second = await ask(opened, `/sites/${source}/duplicate`, { name: "report-three" });
    const cancelled = await ask(opened, `/copies/${second.copy.upload}/cancel`);

    expect([started.map((one) => String(one.upload)), begun.copy.copied, waiting.site, waiting.copy.copied, cost.store]).toEqual([[begun.copy.upload, second.copy.upload], 112, null, null, 0]);
    expect([rounds, made.site?.name, made.copy.copied, cancelled.status, stopped.map((one) => String(one.upload))]).toEqual([["more", "done"], "report-two", 300, 200, [second.copy.upload]]);
    expect(await listed(opened)).toEqual(["report unlisted", "report-two private"]);
  });
});

describe("a cancelled copy", () => {
  // Drift: Cancel would stop the client alone, and the copied files would sit in the store, counted against the install's size, until the sweep.
  test("leaves no file and no site, and cannot be gone on with", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "report", 300);
    const { store } = opened.base.install;
    const before = (await store.list({ prefix: "" })).objects.length;
    const begun = await ask(opened, `/sites/${source}/duplicate`);
    const during = (await store.list({ prefix: "" })).objects.length;

    const cancelled = await ask(opened, `/copies/${begun.copy.upload}/cancel`);
    const next = await ask(opened, `/sites/${source}/duplicate`, { upload: begun.copy.upload });

    expect([during - before, (await store.list({ prefix: "" })).objects.length - before]).toEqual([112, 0]);
    expect([cancelled.status, next.status, next.code, next.about, await listed(opened)]).toEqual([200, 404, "not_found", "upload", ["report unlisted"]]);
    expect(next.sentence).toBe("That copy can no longer be gone on with: it was cancelled, or its day to finish ran out. Unless the list of sites shows it, duplicate the site again.");
  });

  // Drift: a Cancel that arrives after the last file would be told as done, and the person would look for a copy that "was not made" in a list that shows it.
  test("that is a site already is refused as finished, and asking for it again answers the site", async () => {
    const opened = await openConsole();
    const source = await publish(opened, "notes", 3);
    const copied = await ask(opened, `/sites/${source}/duplicate`);

    const cancelled = await ask(opened, `/copies/${copied.copy.upload}/cancel`);
    const again = await ask(opened, `/sites/${source}/duplicate`, { upload: copied.copy.upload });

    expect([cancelled.status, cancelled.code, again.site?.id]).toEqual([409, "upload_finished", copied.site?.id]);
    expect(cancelled.sentence).toBe("The copy is finished already: it is a site of its own now, in the list of sites.");
  });
});

describe("the copy routes", () => {
  // Drift: a page of another site could make copies with a visitor's login until the install is full, or anyone could with none.
  test.each([
    ["no login", { [LOGIN_HEADER]: "" }, 401],
    ["a request from another site", { Origin: "https://other.example.com", "Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain" }, 403],
  ])("refuse %s and copy nothing", async (_name, headers, status) => {
    const opened = await openConsole();
    const source = await publish(opened, "report", 3);

    const answers = [await opened.change(`/data/sites/${source}/duplicate`, {}, headers), await opened.change("/data/copies/0000000000000000/cancel", {}, headers)];

    expect([answers.map((answer) => answer.status), await listed(opened)]).toEqual([[status, status], ["report unlisted"]]);
  });
});
