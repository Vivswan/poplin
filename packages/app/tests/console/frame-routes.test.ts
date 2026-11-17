// The frame's data routes: the newer release and the note on the domain the side shows, and the start of an update from there.

import { describe, expect, test } from "bun:test";

import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { TOKEN, usualPlug } from "./support/fake-plug";
import { openConsole } from "./support/console";
import { readShell } from "./support/shell";

/** A release newer than the test console's version. */
const NEWER = { version: "1.1.0", released: "2026-12-01", notes: "https://example.com/changelog/", schema: OWN_SCHEMA };

/** What the frame holds of the problems of an install where nothing went wrong. */
const NOTHING_MARKED = { recent: [], marks: { usage: null, domain: null, settings: null }, domainAsks: null };

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

type Opened = Awaited<ReturnType<typeof openConsole>>;

/** Let the install know of the newer release, as its daily check would. */
async function learnRelease(opened: Opened): Promise<void> {
  await opened.base.install.database.keepUpdateCheck({ checked_at: opened.base.clock.now, news: NEWER });
}

describe("the frame", () => {
  // Drift: a release the install learned of would show in the side only after a reload, and the side would offer a start on an install whose host holds no key to send it with.
  test("answers the newer release, and whether an update can be started", async () => {
    const opened = await openConsole();
    opened.host.key = false;
    const before = await (await opened.get("/data/frame")).json();
    await learnRelease(opened);
    opened.host.key = true;

    expect(before).toEqual({ ok: true, update: null, starts: false, back: null, domainNote: null, ...NOTHING_MARKED });
    expect(await (await opened.get("/data/frame")).json()).toEqual({
      ok: true,
      update: { current: "1.0.0", newest: "1.1.0", released: NEWER.released, notes: NEWER.notes, database: false },
      starts: true,
      back: null,
      domainNote: null,
      ...NOTHING_MARKED,
    });
  });

  // Drift: the way back is offered from what the host keeps of the last update. Offered after an update that changed the database, the button would ask for code that cannot read it.
  test.each([
    ["the last update, with the database as it was", { from: "0.9.0", to: "1.0.0", schema: OWN_SCHEMA, at: 1_790_000_000_000 }, { to: "0.9.0", since: 1_790_000_000_000 }],
    ["the last update, which changed the database", { from: "0.9.0", to: "1.0.0", schema: OWN_SCHEMA + 1, at: 1_790_000_000_000 }, null],
    ["no update", undefined, null],
  ])("of an install whose host keeps %s answers the way back %p", async (_what, last, back) => {
    const opened = await openConsole();
    opened.host.last = last;

    expect(await (await opened.get("/data/frame")).json()).toMatchObject({ back });
  });

  // Drift: a record a check found missing would show only on the Domain screen, or a repaired domain would go on saying it needs fixing.
  test("says what the last run on the domain left to do: nothing before one, the alarm after a check that found work, nothing after the repair", async () => {
    const opened = await openConsole("", usualPlug());
    const note = async (): Promise<unknown> => ((await (await opened.get("/data/frame")).json()) as { readonly domainNote: unknown }).domainNote;
    const never = await note();
    await opened.change("/data/domain/check", { token: TOKEN });
    const found = await note();
    await opened.change("/data/domain/repair", { token: TOKEN });

    expect([never, found, await note()]).toEqual([
      null,
      {
        label: "Domain needs fixing",
        sentence: "The DNS record is missing or changed, so sites may not open. Open Domain and press Repair.",
        quiet: false,
      },
      null,
    ]);
  });

  // Drift: a check a month old would still alarm a person about a state nobody has read since, or a console with no Domain screen would tell a person to open one.
  test.each([
    ["a Domain screen and a check 31 days old", true, 31, { label: "Domain check is old", sentence: "The last check of the domain is over 30 days old. Open Domain and press Check.", quiet: true }],
    ["no Domain screen and a check of today", false, 0, null],
  ] as const)("of an install with %s that remembers a broken record says %p", async (_what, screen, days, note) => {
    const opened = await openConsole("", screen ? usualPlug() : undefined);
    const { install, owner } = opened.base;
    const piece = { piece: "DNS record", detail: "poplin.example.com", part: "reach", state: "needs_repair" } as const;
    await install.database.keepDomainCheck({ ran_at: install.now() - days * DAY_MS, by: owner, run: "check", pieces: [piece] }, { run: "check", from: "dashboard" });

    expect(await (await opened.get("/data/frame")).json()).toMatchObject({ domainNote: note });
  });

  // Drift: an install without a domain would be told of "the domain" it has not, or of a record where its own piece is another.
  test("words the note by what the plug calls its side, and names the piece sites answer through", async () => {
    const opened = await openConsole("", { ...usualPlug(), words: { thing: "the install", line: null } });
    const { install, owner } = opened.base;
    const sentence = async (): Promise<unknown> => ((await (await opened.get("/data/frame")).json()) as { readonly domainNote: { readonly sentence: string } }).domainNote.sentence;
    const kept = async (days: number, part: "reach" | "rest"): Promise<unknown> => {
      const piece = { piece: "Forwarder", detail: "poplin-sites", part, state: "needs_repair" } as const;
      await install.database.keepDomainCheck({ ran_at: install.now() - days * DAY_MS, by: owner, run: "check", pieces: [piece] }, { run: "check", from: "dashboard" });

      return sentence();
    };

    expect([await kept(0, "reach"), await kept(0, "rest"), await kept(31, "rest")]).toEqual([
      "The Forwarder is missing or changed, so sites may not open. Open Domain and press Repair.",
      "A piece of the install is missing or changed. Open Domain and press Repair.",
      "The last check of the install is over 30 days old. Open Domain and press Check.",
    ]);
  });

  // Drift: the page would start from other values than the route answers, and the side would change on its first read.
  test("is what the shell page starts from", async () => {
    const opened = await openConsole();
    await learnRelease(opened);
    const page = await (await opened.get("/")).text();
    const { ok, ...frame } = (await (await opened.get("/data/frame")).json()) as Record<string, unknown>;

    expect(ok).toBe(true);
    expect((await readShell(page)).boot).toMatchObject(frame);
  });
});

describe("starting an update", () => {
  // Drift: the button would put nothing in place, or leave no line in the log.
  test("has the host put the newest release in place and writes it down", async () => {
    const opened = await openConsole();
    const response = await opened.change("/data/update", {});

    expect([response.status, await response.json(), opened.host.put]).toEqual([200, { ok: true, to: "1.1.0" }, ["1.1.0"]]);
    expect((await opened.base.audit()).map((entry) => entry.action)).toContain("update_started");
  });

  // Drift: going back is a start that names the version before. A body the route passed over would take the newest release, and put the install forward where a person asked to go back.
  test("with a version takes that one, a lower one too, and refuses a text that is no version", async () => {
    const opened = await openConsole();
    const back = await opened.change("/data/update", { to: "0.9.0" });
    const bad = await opened.change("/data/update", { to: "the one before" });

    expect([back.status, await back.json(), bad.status, opened.host.put]).toEqual([200, { ok: true, to: "0.9.0" }, 400, ["0.9.0"]]);
    expect((await opened.base.audit()).filter((entry) => entry.action === "update_started").map((entry) => entry.detail)).toEqual([{ from: "1.0.0", to: "0.9.0" }]);
  });

  // Drift: a refused start would reach the admin as a code with no sentence, and the list of problems would tell them to check a link that no longer exists.
  test.each<{ readonly name: string; readonly host: Partial<Opened["host"]>; readonly status: number; readonly code: string; readonly about: string | null; readonly sentence: string; readonly noted: boolean }>([
    { name: "the host holds no key", host: { key: false }, status: 409, code: "no_key", about: null, sentence: "poplin holds no key, so it cannot update itself. Open Domain and press Repair.", noted: false },
    { name: "no newer version is out", host: { release: null }, status: 409, code: "no_update", about: null, sentence: "No newer version is known, so no update was started.", noted: false },
    {
      name: "the fetched files are not the published ones",
      host: { refusal: { ok: false, code: "release_refused", about: "digest_differs" } },
      status: 502,
      code: "release_refused",
      about: "digest_differs",
      sentence: "The files fetched for the release are not the files poplin published. Nothing was changed. Try again; if it says this again, tell the project.",
      noted: true,
    },
  ])("refuses while $name with a sentence of its own, puts nothing in place, and a problem it notes gives that sentence as what to do", async ({ host, status, code, about, sentence, noted }) => {
    const opened = await openConsole();
    Object.assign(opened.host, host);
    const response = await opened.change("/data/update", {});
    const { recent } = (await (await opened.get("/data/frame")).json()) as { readonly recent: readonly { readonly kind: string; readonly todo: string }[] };

    expect([response.status, await response.json(), opened.host.put]).toEqual([status, { ok: false, code, about, sentence }, []]);
    expect(recent.map(({ kind, todo }) => [kind, todo])).toEqual(noted ? [["update_failed", sentence]] : []);
  });

  // Drift: a second press in the same minute would fetch and upload the release twice.
  test("takes one start a minute", async () => {
    const opened = await openConsole();
    await opened.change("/data/update", {});
    const second = await opened.change("/data/update", {});

    expect([await second.json(), opened.host.put]).toMatchObject([{ ok: false, code: "too_many_requests" }, ["1.1.0"]]);
  });
});
