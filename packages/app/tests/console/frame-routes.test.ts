// The frame's data routes: the title, the newer release, and the note on the domain the side shows, and the start of an update from there.

import { describe, expect, test } from "bun:test";

import { TOKEN, usualPlug } from "./support/fake-plug";
import { openConsole, REBUILD_HOST } from "./support/console";
import { readShell } from "./support/shell";

/** A release newer than the test console's version. */
const NEWER = { version: "1.1.0", released: "2026-12-01", notes: "https://example.com/changelog/", database: false };

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The address the tests save as the one that starts a rebuild. */
const ADDRESS = `https://${REBUILD_HOST}/start/a-long-secret-part`;

type Opened = Awaited<ReturnType<typeof openConsole>>;

/** Let the install know of the newer release, as its daily check would. */
async function learnRelease(opened: Opened): Promise<void> {
  await opened.base.install.database.keepUpdateCheck({ checked_at: opened.base.clock.now, news: NEWER });
}

describe("the frame", () => {
  // Drift: a title saved on the Settings screen would show in the side only after a reload, and the side would offer a start with no address to send it to.
  test("answers the saved title, the newer release, and whether an update can be started", async () => {
    const opened = await openConsole();
    const before = await (await opened.get("/data/frame")).json();
    await learnRelease(opened);
    await opened.change("/data/settings", { texts: { dashboard_title: "Field notes" } });
    await opened.change("/data/settings/update-address", { address: ADDRESS });

    expect(before).toEqual({ ok: true, title: "poplin.example.com", update: null, starts: false, domainNote: null });
    expect(await (await opened.get("/data/frame")).json()).toEqual({
      ok: true,
      title: "Field notes",
      update: { current: "1.0.0", newest: "1.1.0", released: NEWER.released, notes: NEWER.notes, database: false },
      starts: true,
      domainNote: null,
    });
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
        sentence: "A record or route of the domain is missing or changed, so sites may not open. Open Domain and press Repair.",
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

  // Drift: the page would start from other values than the route answers, and the side would change on its first read.
  test("is what the shell page starts from", async () => {
    const opened = await openConsole();
    await learnRelease(opened);
    await opened.change("/data/settings/update-address", { address: ADDRESS });
    const page = await (await opened.get("/")).text();
    const { ok, ...frame } = (await (await opened.get("/data/frame")).json()) as Record<string, unknown>;

    expect(ok).toBe(true);
    expect((await readShell(page)).boot).toMatchObject(frame);
  });
});

describe("starting an update", () => {
  // Drift: the button would send nothing, send to another address than the saved one, or leave no line in the log.
  test("sends one request to the saved address and writes it down", async () => {
    const opened = await openConsole();
    await learnRelease(opened);
    await opened.change("/data/settings/update-address", { address: ADDRESS });
    const response = await opened.change("/data/update", {});
    const answer = await response.text();

    expect([response.status, JSON.parse(answer)]).toEqual([200, { ok: true, to: "1.1.0" }]);
    expect(opened.rebuilds).toEqual([ADDRESS]);
    expect((await opened.base.audit()).map((entry) => entry.action)).toContain("update_started");
    expect(answer).not.toContain("a-long-secret-part");
  });

  // Drift: a refused start would be sent anyway, or would reach the admin as a code with no sentence.
  test.each([
    ["no address is saved", async (opened: Opened) => learnRelease(opened), "no_update_address"],
    ["no newer version is known", async (opened: Opened) => void (await opened.change("/data/settings/update-address", { address: ADDRESS })), "no_update"],
  ])("refuses while %s, with a sentence of its own, and sends nothing", async (_what, prepare, code) => {
    const opened = await openConsole();
    await prepare(opened);
    const response = await opened.change("/data/update", {});
    const refusal = (await response.json()) as { readonly sentence: string };

    expect([response.status, refusal]).toMatchObject([400, { ok: false, code }]);
    expect(refusal.sentence).not.toBe("The request was refused.");
    expect(opened.rebuilds).toEqual([]);
  });

  // Drift: a second press in the same minute would rebuild the install twice.
  test("takes one start a minute", async () => {
    const opened = await openConsole();
    await learnRelease(opened);
    await opened.change("/data/settings/update-address", { address: ADDRESS });
    await opened.change("/data/update", {});
    const second = await opened.change("/data/update", {});

    expect(await second.json()).toMatchObject({ ok: false, code: "too_many_requests" });
    expect(opened.rebuilds).toHaveLength(1);
  });
});
