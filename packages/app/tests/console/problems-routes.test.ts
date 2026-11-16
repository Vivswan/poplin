// The routes of what went wrong: the list the Usage screen shows, and what the frame marks at the side.

import { describe, expect, test } from "bun:test";

import { dayOf } from "@poplin/core/src/records/views";

import { TOKEN, usualPlug } from "./support/fake-plug";
import { openConsole } from "./support/console";

/** The milliseconds of one hour and of one day. */
const [HOUR_MS, DAY_MS] = [3_600_000, 86_400_000];

type Opened = Awaited<ReturnType<typeof openConsole>>;

/** Note a kind as the install would, `ago` milliseconds before the console's clock. */
async function note(opened: Opened, kind: "request_failed" | "login_unchecked" | "update_failed" | "requests_limit_reached", ago: number, message: string | null = null): Promise<void> {
  await opened.base.install.database.noteProblem({ kind, at: opened.base.clock.now - ago, count: 1, more: false, name: message === null ? null : "Error", message });
}

describe("the list of problems", () => {
  // Drift: the screen draws what this route answers and holds no words of its own. A problem without its sentence, its home, or its setting would be a row a person cannot read or act on.
  test("answers each problem of the days asked for with its words, the screen where it is acted on, and the setting of a limit, the newest first", async () => {
    const opened = await openConsole();
    const now = opened.base.clock.now;
    await note(opened, "request_failed", 8 * DAY_MS, "out of the week");
    await note(opened, "requests_limit_reached", 2 * DAY_MS);
    await note(opened, "request_failed", HOUR_MS, "the store did not answer");
    const week = (await (await opened.get("/data/problems?days=7")).json()) as { readonly problems: readonly unknown[] };
    const month = (await (await opened.get("/data/problems?days=30")).json()) as { readonly problems: readonly { readonly kind: string }[] };

    expect<unknown>(week).toEqual({
      ok: true,
      days: 7,
      problems: [
        {
          day: dayOf(now - HOUR_MS),
          kind: "request_failed",
          count: 1,
          more: false,
          first_at: now - HOUR_MS,
          last_at: now - HOUR_MS,
          name: "Error",
          message: "the store did not answer",
          sentence: "A request failed",
          todo: "Try again. If it comes back, copy the details and report it.",
          home: "usage",
          setting: null,
        },
        {
          day: dayOf(now - 2 * DAY_MS),
          kind: "requests_limit_reached",
          count: 1,
          more: false,
          first_at: now - 2 * DAY_MS,
          last_at: now - 2 * DAY_MS,
          name: null,
          message: null,
          sentence: "The daily limit of requests was reached",
          todo: "It works again after midnight UTC. To allow more, raise the limit in Settings.",
          home: "usage",
          setting: "requests_per_day",
        },
      ],
    });
    expect(month.problems.map((problem) => problem.kind)).toEqual(["request_failed", "requests_limit_reached", "request_failed"]);
  });

  // Drift: the list names what broke inside the install, which only a logged-in admin reads.
  test("is answered to nobody without a login", async () => {
    const opened = await openConsole();
    const answer = await opened.getLoggedOut("/data/problems?days=7");

    expect([answer.status, ((await answer.json()) as { readonly code: string }).code]).toEqual([401, "no_login"]);
  });
});

describe("a console with no Domain screen", () => {
  // Drift: a problem of the domain would be marked at a section that is not there and linked to a screen that answers nothing.
  test("shows a problem of the domain on Usage, in the list and in the frame's marks", async () => {
    const opened = await openConsole();
    await note(opened, "login_unchecked", HOUR_MS);
    const listed = (await (await opened.get("/data/problems?days=7")).json()) as { readonly problems: readonly { readonly home: string }[] };
    const frame = (await (await opened.get("/data/frame")).json()) as { readonly marks: unknown; readonly recent: readonly { readonly home: string }[] };

    expect([listed.problems.map((problem) => problem.home), frame.recent.map((problem) => problem.home)]).toEqual([["usage"], ["usage"]]);
    expect(frame.marks).toEqual({ usage: { count: 1, says: "The login could not be checked" }, domain: null, settings: null });
  });
});

describe("what the frame marks at the side", () => {
  // Drift: the mark at a section is the one sign that something is wrong. A problem counted under another screen, or one of two days ago still marked, would send a person to a screen with nothing to act on.
  test("marks each screen with the kinds last seen within a day that belong to it, a kind seen on two days once, and carries them for the screens to show", async () => {
    const opened = await openConsole("", usualPlug());
    const frame = async (): Promise<{ readonly marks: unknown; readonly recent: readonly { readonly kind: string }[] }> => (await (await opened.get("/data/frame")).json()) as never;
    const before = await frame();
    await note(opened, "request_failed", 25 * HOUR_MS);
    await note(opened, "update_failed", 23 * HOUR_MS);
    await note(opened, "login_unchecked", 23 * HOUR_MS);
    await note(opened, "login_unchecked", 2 * HOUR_MS);
    await note(opened, "requests_limit_reached", HOUR_MS);
    const after = await frame();

    expect([before.marks, before.recent]).toEqual([{ usage: null, domain: null, settings: null }, []]);
    expect(after.marks).toEqual({
      usage: { count: 1, says: "The daily limit of requests was reached" },
      domain: { count: 1, says: "The login could not be checked" },
      settings: { count: 1, says: "An update did not go as it should" },
    });
    expect(after.recent.map((problem) => problem.kind)).toEqual(["requests_limit_reached", "login_unchecked", "update_failed"]);
  });

  // Drift: what the domain needs and a problem at the domain are both marked at the Domain section. Two rules would light the mark twice, or leave it dark while the side says the domain needs fixing.
  test("marks the Domain screen for a check that found work as for a problem there, counts both, and marks nothing for a check that is only old", async () => {
    const opened = await openConsole("", usualPlug());
    const { install, owner } = opened.base;
    const domain = async (): Promise<unknown> => ((await (await opened.get("/data/frame")).json()) as { readonly marks: { readonly domain: unknown } }).marks.domain;
    await opened.change("/data/domain/check", { token: TOKEN });
    const found = await domain();
    await note(opened, "login_unchecked", HOUR_MS);
    const both = await domain();
    const piece = { piece: "DNS record", detail: "poplin.example.com", part: "reach", state: "needs_repair" } as const;
    await install.database.keepDomainCheck({ ran_at: install.now() - 31 * DAY_MS, by: owner, run: "check", pieces: [piece] }, { run: "check", from: "dashboard" });

    const needsFixing = "The DNS record is missing or changed, so sites may not open. Open Domain and press Repair.";
    expect([found, both, await domain()]).toEqual([{ count: 1, says: needsFixing }, { count: 2, says: needsFixing }, { count: 1, says: "The login could not be checked" }]);
  });
});
