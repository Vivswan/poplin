// The Domain screen's data routes: what the screen opens with, the two runs with the token in the body, and the words a run is answered in.

import { describe, expect, test } from "bun:test";

import type { Login } from "@poplin/core/src/auth/logins";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import type { DomainCheck } from "@poplin/core/src/records/domain-check";

import { keptAnswer, runDone } from "../../src/console/domain-answers";
import type { DomainReading, DomainRow, DomainState } from "../../src/console/domain/records";
import { fakePlug, selfCheckingPlug, TOKEN, usualPlug } from "./support/fake-plug";
import { openConsole } from "./support/console";
import { readShell } from "./support/shell";

/** What a run that read its pieces answers. */
interface Ran {
  readonly ok: true;
  readonly rows: readonly { readonly piece: string; readonly state: string; readonly tone: string; readonly detail: string }[];
  readonly summary: { readonly line: string; readonly tone: string };
}

/** What a refused request answers. */
interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
}

/** Who ran the remembered runs the tests write by hand. */
const BY = "mira@example.com" as Login;

/** A remembered piece that was not read, for the reason given. */
function unread(reason: "failed" | "not_run" | "missing_right"): DomainCheck["pieces"][number] {
  const named = { piece: "Route", detail: "refused", part: "reach", state: "unread" } as const;

  return reason === "missing_right" ? { ...named, reason, right: "Routes: Edit" } : { ...named, reason };
}

/** Rows in the given states, each a piece of its own. */
function rowsIn(...states: DomainState[]): DomainRow[] {
  return states.map((state, place) => ({ object: `Piece ${place}`, state, detail: `detail ${place}`, part: "rest" }));
}

describe("what the screen opens with", () => {
  // Drift: the screen would show a token form of its own invention, or a remembered run where the install remembers none.
  test("is the plug's own token facts, its own words for what the screen is about, and no remembered run; opening it runs nothing", async () => {
    const plug = usualPlug();
    const opened = await openConsole("", plug);
    const answer = await opened.get("/data/domain");

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      ok: true,
      form: {
        tokenRights: ["Records: Edit", "Routes: Edit"],
        tokenLink: "https://provider.example/tokens/new",
        tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods first." }],
        tokenNote: "Choose what the account token is for.",
      },
      words: { thing: "the domain", line: null },
      checks_alone: false,
      last: null,
    });
    expect(plug.calls).toEqual([]);
  });

  // Drift: the screen asks for a token wherever this says a check needs one. Said of an install whose plug checks by itself, the owner is asked for a token the install has no use for.
  test("says a check needs no token on an install whose plug checks by itself, and reading that runs nothing", async () => {
    const plug = selfCheckingPlug();
    const opened = await openConsole("", plug);

    expect([((await (await opened.get("/data/domain")).json()) as { checks_alone: boolean }).checks_alone, plug.calls]).toEqual([true, []]);
  });

  // Drift: the screen would open as never checked after a run, so a person who comes back cannot see what the last run found, when, or who ran it.
  test("is, after a run, that run as the install keeps it: when, by whom, each piece, and the count", async () => {
    const opened = await openConsole("", usualPlug());
    await opened.change("/data/domain/check", { token: TOKEN });
    const { last } = (await (await opened.get("/data/domain")).json()) as { readonly last: unknown };

    expect(last).toEqual({
      ran_at: opened.base.clock.now,
      by: opened.base.owner,
      run: "check",
      stale: false,
      waits: false,
      rows: [
        { piece: "DNS record", state: "present", tone: "good", detail: "*.example.com" },
        { piece: "DNS record", state: "needs repair", tone: "bad", detail: "poplin.example.com" },
        { piece: "Worker route", state: "present", tone: "good", detail: "poplin.example.com/*" },
        { piece: "Rate rule", state: "optional", tone: "idle", detail: "rate rule: the domain has other hostnames" },
      ],
      summary: { line: "1 to repair", tone: "bad" },
    });
  });

  // Drift: Access sends a person to Domain to press Repair. A screen that then says nothing is left, a check that clears what only a repair settles, or a removed user that raises nothing, leaves the domain's login out of step with the users.
  test.each([
    ["added", "/data/people/add"],
    ["removed", "/data/people/remove"],
  ] as const)("says that a repair waits once a user was %s, through a check, until a repair that leaves the login standing", async (_what, path) => {
    const opened = await openConsole("", fakePlug(() => ({ ok: true, rows: [{ object: "Login policy", state: "present", detail: "the logins", part: "login" }], steps: [] })));
    const login = "bo@example.com";
    const shown = async (): Promise<unknown> => {
      const { last } = (await (await opened.get("/data/domain")).json()) as { readonly last: { readonly waits: boolean; readonly summary: Ran["summary"] } };
      const { domainNote } = (await (await opened.get("/data/frame")).json()) as { readonly domainNote: { readonly sentence: string } | null };

      return [last.waits, last.summary.line, last.summary.tone, domainNote?.sentence ?? null];
    };
    const ran = async (run: "check" | "repair"): Promise<string> => ((await (await opened.change(`/data/domain/${run}`, { token: TOKEN })).json()) as Ran).summary.line;
    if (path.endsWith("remove")) await opened.change("/data/people/add", { login });

    const lines = [await ran("repair")];
    const before = await shown();
    await opened.change(path, { login });
    const waiting = await shown();
    lines.push(await ran("check"));
    const checked = await shown();
    lines.push(await ran("repair"));

    const [quiet, raised] = [[false, "Nothing to repair", "good", null], [true, "Users changed. Press Repair.", "bad", "Users changed. Open Domain and press Repair."]];
    expect([before, waiting, checked, await shown()]).toEqual([quiet, raised, raised, quiet]);
    expect(lines).toEqual(["Nothing to repair", "Users changed. Press Repair.", "Nothing to repair"]);
  });

  // Drift: a console built without the provider's side would answer a screen it cannot run.
  test.each([
    ["GET", "/data/domain", undefined],
    ["POST", "/data/domain/check", { token: TOKEN }],
    ["POST", "/data/domain/repair", { token: TOKEN }],
  ])("is not there without a plug: %s %s", async (method, path, body) => {
    const opened = await openConsole();
    const answer = method === "GET" ? await opened.get(path) : await opened.change(path, body);

    expect([answer.status, ((await answer.json()) as Refusal).code]).toEqual([404, "no_page"]);
  });

  // Drift: the shell would show a Domain section that leads nowhere, or hide the one that works.
  test.each([
    [true, usualPlug()],
    [false, undefined],
  ])("tells the client whether it has the screen: %p", async (has, plug) => {
    const opened = await openConsole("", plug);
    const shell = await readShell(await (await opened.get("/")).text());

    expect(shell.boot).toMatchObject({ domain: has });
  });
});

describe("a run", () => {
  // Drift: a check would change the provider, lose the stored settings, skip the audit entry, or count its rows wrongly.
  test("hands the plug the token and the stored settings, answers every row with the count, and writes one audit entry", async () => {
    const plug = usualPlug();
    const opened = await openConsole("", plug);
    const answer = await opened.change("/data/domain/check", { token: TOKEN });
    const ran = (await answer.json()) as Ran;

    expect(answer.status).toBe(200);
    expect(ran.rows).toEqual([
      { piece: "DNS record", state: "present", tone: "good", detail: "*.example.com" },
      { piece: "DNS record", state: "missing", tone: "bad", detail: "poplin.example.com" },
      { piece: "Worker route", state: "present", tone: "good", detail: "poplin.example.com/*" },
      { piece: "Rate rule", state: "left out", tone: "idle", detail: "rate rule: the domain has other hostnames" },
    ]);
    expect(ran.summary).toEqual({ line: "1 to repair", tone: "bad" });
    expect(plug.calls).toMatchObject([{ run: "check", token: TOKEN, settings: { outside_pages: "blocked", logins: [opened.base.owner] } }]);
    expect((await opened.base.audit())[0]).toMatchObject({ action: "domain_synced", by: opened.base.owner, detail: { run: "check", from: "dashboard" } });
  });

  // Drift: a check of an install that checks by itself would wait for a token, hand a pasted one to the plug, or fill Activity with one line each time the screen opened.
  test.each([
    ["pressed with nothing sent", {}, 1],
    ["pressed with a token sent all the same", { token: TOKEN }, 1],
    ["run by the screen on opening", { unasked: true }, 0],
  ] as const)("on an install whose plug checks by itself, a check %s runs the plug's own check with no token and is remembered; only a pressed one writes an audit entry", async (_name, sent, entries) => {
    const plug = selfCheckingPlug();
    const opened = await openConsole("", plug);
    const before = (await opened.base.audit()).length;
    const answer = await opened.change("/data/domain/check", sent);
    const ran = (await answer.json()) as Ran;
    const { last } = (await (await opened.get("/data/domain")).json()) as { readonly last: { readonly run: string; readonly by: string } | null };

    expect([answer.status, ran.summary, plug.calls.map((call) => [call.run, call.token])]).toEqual([200, { line: "1 to repair", tone: "bad" }, [["check", null]]]);
    expect([last?.run, last?.by, (await opened.base.audit()).length - before]).toEqual(["check", opened.base.owner, entries]);
  });

  // Drift: a repair changes the provider, which the install's own hold on it may not. A repair that ran with no token, or a check with none on an install that needs one, would be a run nobody authorised.
  test("a repair always takes the token, and a check with none on an install that needs one is refused at the token's box with the plug never asked", async () => {
    const [own, usual] = [selfCheckingPlug(), usualPlug()];
    const repaired = await (await openConsole("", own)).change("/data/domain/repair", { token: TOKEN });
    const unsent = await (await openConsole("", own)).change("/data/domain/repair", {});
    const checked = await (await openConsole("", usual)).change("/data/domain/check", { unasked: true });

    expect([repaired.status, own.calls.map((call) => [call.run, call.token]), unsent.status, usual.calls]).toEqual([200, [["repair", TOKEN]], 400, []]);
    expect([checked.status, await checked.json()]).toEqual([403, { ok: false, code: "token", about: "token", sentence: expect.any(String) }]);
  });

  // Drift: the pasted token would come back in an answer, a header, or the audit log, where a screen share or a log reader finds it.
  test("answers nothing that holds the token, even from a plug that hands it back in every text", async () => {
    const echoing = fakePlug((_run, token) => ({
      ok: true,
      rows: [{ object: `Record ${token}`, state: "failed", detail: `refused ${token}`, part: "rest" }],
      steps: [{ text: `Open ${token}`, address: `https://provider.example/${token}` }],
    }));
    const opened = await openConsole("", echoing);
    const answer = await opened.change("/data/domain/repair", { token: TOKEN });
    const emitted = JSON.stringify([[...answer.headers], await answer.text(), await opened.base.audit()]);

    expect(answer.status).toBe(200);
    expect(emitted).not.toContain(TOKEN);
    expect(emitted).toContain("Record [token]");
  });

  // Drift: a refusal would lose its status, its sentence, or the box it belongs at, would write an audit entry for a run that read nothing, or would ask an install without a domain for a token made for one.
  test.each([
    ["token", 403, "token", "Account token refused: paste the whole account token, made for this account and this domain.", "this account and this domain"],
    ["unreachable", 502, null, "No answer from the provider. Try again.", "this account"],
    ["allowance_spent", 503, null, "The database takes no more today: its free allowance for the day is used up. Try again after midnight UTC.", "this account"],
    ["token", 403, "token", "Account token refused: paste the whole account token, made for this account.", "this account"],
  ] as const)("that reads no table is the refusal %s: status %i, about %p", async (refusal, status, about, sentence, tokenFor) => {
    const opened = await openConsole("", { ...fakePlug(() => ({ ok: false, refusal })), tokenFor });
    const before = (await opened.base.audit()).length;
    const answer = await opened.change("/data/domain/check", { token: TOKEN });

    expect([answer.status, await answer.json()]).toEqual([status, { ok: false, code: refusal, about, sentence }]);
    expect((await opened.base.audit()).length).toBe(before);
  });

  // Drift: a repair that the database's spent allowance stops would answer a bare failure, and the screen would say the dashboard did not answer after the provider was changed.
  test("that meets a database which takes no more today is the refusal allowance_spent, with the time to wait", async () => {
    const spent = fakePlug(() => {
      throw new AllowanceSpent("writing");
    });
    const opened = await openConsole("", spent);
    const answer = await opened.change("/data/domain/repair", { token: TOKEN });

    expect([answer.status, ((await answer.json()) as Refusal).code, Number(answer.headers.get("Retry-After")) > 0]).toEqual([503, "allowance_spent", true]);
  });

  // Drift: a page of another origin could make a logged-in admin's browser repair the domain with a token of its choosing.
  test("is refused, and the plug never asked, when it is sent as a form or from another origin", async () => {
    const plug = usualPlug();
    const opened = await openConsole("", plug);
    const asForm = await opened.change("/data/domain/repair", "token=x", { "Content-Type": "application/x-www-form-urlencoded" });
    const fromElsewhere = await opened.change("/data/domain/repair", "token=x", {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://elsewhere.example",
      "Sec-Fetch-Site": "cross-site",
    });

    expect([asForm.status, fromElsewhere.status, plug.calls]).toEqual([415, 403, []]);
  });
});
describe("the line that counts a run's rows", () => {
  // Drift: the line would claim a repair that left work was done, or count an optional piece as work.
  test.each([
    ["check", rowsIn("present", "missing", "differs", "left-out"), "2 to repair", "bad"],
    ["repair", rowsIn("created", "changed", "removed", "present"), "3 repaired", "good"],
    ["repair", rowsIn("present", "present"), "Nothing to repair", "good"],
    ["check", rowsIn("present", "created"), "Nothing to repair", "good"],
    ["repair", rowsIn("created", "failed", "present"), "1 not done", "bad"],
    ["repair", rowsIn("failed", "not-run", "missing"), "3 not done", "bad"],
    ["repair", rowsIn("created", "optional", "optional"), "1 repaired", "good"],
    ["check", rowsIn("present", "optional"), "Nothing to repair", "good"],
  ] as const)("after a %s of %p says %s", (run, rows, line, tone) => {
    const reading: Extract<DomainReading, { ok: true }> = { ok: true, rows: [...rows], steps: [] };

    expect(runDone(run, reading, false).summary).toEqual({ line, tone });
  });

  // Drift: a user added in Access cannot log in until a repair, and a green "Nothing to repair" would say there is nothing to do. Said over a count of work, it would hide the pieces a repair must also mend.
  test.each([
    ["check", rowsIn("present", "optional"), "Users changed. Press Repair.", "bad"],
    ["repair", rowsIn("created", "present"), "Users changed. Press Repair.", "bad"],
    ["check", rowsIn("present", "missing"), "1 to repair", "bad"],
    ["repair", rowsIn("created", "failed"), "1 not done", "bad"],
  ] as const)("after a %s of %p while changed users wait for a repair says %s", (run, rows, line, tone) => {
    expect(runDone(run, { ok: true, rows: [...rows], steps: [] }, true).summary).toEqual({ line, tone });
  });

  // Drift: an optional piece that is not set up would read as a failure.
  test("draws an optional piece as idle, in the words the install guide quotes", () => {
    expect(runDone("check", { ok: true, rows: rowsIn("optional"), steps: [] }, false).rows).toEqual([
      { piece: "Piece 0", state: "optional", tone: "idle", detail: "detail 0" },
    ]);
  });
});

describe("the run the install remembers", () => {
  // Drift: the screen would open on a remembered run with the wrong count, or call a piece that was never read present.
  test("is drawn with each piece's state, counted as a check", () => {
    const kept = keptAnswer({
      stale: true,
      waits: true,
      check: {
        ran_at: 1_700_000_000_000,
        by: BY,
        run: "repair",
        pieces: [
          { piece: "DNS record", detail: "every site", part: "reach", state: "ok" },
          { piece: "Login policy", detail: "the logins", part: "login", state: "needs_repair" },
          { piece: "Rate rule", detail: "left out", part: "rest", state: "not_set_up" },
          { piece: "Route", detail: "never reached", part: "reach", state: "unread", reason: "not_run" },
        ],
      },
    });

    expect(kept).toEqual({
      ran_at: 1_700_000_000_000,
      by: "mira@example.com",
      run: "repair",
      stale: true,
      waits: true,
      rows: [
        { piece: "DNS record", state: "present", tone: "good", detail: "every site" },
        { piece: "Login policy", state: "needs repair", tone: "bad", detail: "the logins" },
        { piece: "Rate rule", state: "optional", tone: "idle", detail: "left out" },
        { piece: "Route", state: "not run", tone: "idle", detail: "never reached" },
      ],
      summary: { line: "2 not done", tone: "bad" },
    });
    expect(keptAnswer({ check: null, stale: false, waits: false })).toBeNull();
  });

  // Drift: a piece the last run failed at, or never reached, would be counted as nothing to do.
  test.each([
    ["failed", "failed"],
    ["missing_right", "failed"],
    ["not_run", "not run"],
  ] as const)("counts a piece unread for %s as not done", (reason, state) => {
    const kept = keptAnswer({ stale: false, waits: false, check: { ran_at: 1, by: BY, run: "check", pieces: [unread(reason)] } });

    expect([kept?.summary.line, kept?.summary.tone, kept?.rows[0]?.state]).toEqual(["1 not done", "bad", state]);
  });
});
