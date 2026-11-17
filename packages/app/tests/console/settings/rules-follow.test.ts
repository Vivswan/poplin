// The settings of the domain's rules carried to the provider after a change of them: which values the provider ends with, what keeps waiting, and what is noted for a person.
// Without these a saved setting could wait for a repair nobody is told to press, the provider could keep rules of older values while nothing waits, or a save of any other setting could call the provider for nothing.
// The fake reads its rules before it writes them, as the provider's side does, and a test may make one read answer what the rules held before the last write.

import { describe, expect, test } from "bun:test";
import type { RuleSettings, SettingValues } from "@poplin/core/src/records/settings";

import type { FollowRefusal, FollowTry } from "../../../src/console/access/users-follow";
import { followRules, type RulesFollow } from "../../../src/console/settings/rules-follow";
import { openConsole } from "../support/console";
import { usualPlug } from "../support/fake-plug";
import { ORIGIN, openOwned } from "../support/install";

/** A test install. */
type Owned = Awaited<ReturnType<typeof openOwned>>;

/** A provider's side of the rules written by hand: it holds the last values it took, and records every try. */
interface FakeRules extends RulesFollow {
  /** The values of every try, in order. */
  readonly pushed: RuleSettings[];

  /** The values the provider's rules were last written from, `undefined` before any. */
  held: RuleSettings | undefined;

  /** What the next try reads the rules as, in place of what they hold: a read that trails a write. */
  trails: RuleSettings | undefined;
}

/** The values every test install starts with. */
const BLOCKED: RuleSettings = { outside_pages: "blocked", search_engines_allowed: false };

/**
 * Make a provider's side of the rules.
 *
 * @param answer - what a try answers, told how many came before it; a try it leaves alone is taken. It runs while the try is under way, so a test changes a setting from it as another admin would meanwhile
 */
function fakeRules(answer: (earlier: number) => Promise<FollowRefusal | undefined> | FollowRefusal | undefined = () => undefined, holdsKey = true): FakeRules {
  const rules: FakeRules = {
    pushed: [],
    held: undefined,
    trails: undefined,
    holdsKey: () => holdsKey,
    async push(values) {
      rules.pushed.push(values);
      const refusal = await answer(rules.pushed.length - 1);
      if (refusal !== undefined) return { ok: false, refusal };

      const read = rules.trails ?? rules.held;
      rules.trails = undefined;
      const stood = read?.outside_pages === values.outside_pages && read.search_engines_allowed === values.search_engines_allowed;
      if (!stood) rules.held = values;

      return { ok: true, rules: stood ? "stood" : "written" };
    },
  };

  return rules;
}

/** Keep a first run of the domain, so the install remembers a change, then change some settings a moment later. */
async function changed(opened: Owned, changes: Partial<SettingValues>): Promise<void> {
  if ((await opened.install.database.readDomainCheck()) === undefined) {
    await opened.install.database.keepDomainCheck({ ran_at: opened.install.now(), by: opened.owner, run: "repair", pieces: [] }, {});
  }

  opened.clock.now += 1;
  await opened.install.database.changeSettings(changes, { as: "person", by: opened.owner, at: opened.install.now() });
}

/** Move the clock a minute on, and answer a try that trusts its reads where nothing changed or tried in that minute, as the scheduled run makes one. */
function aMinuteOn(opened: Owned): FollowTry {
  opened.clock.now += 60_000;

  return { quietSince: opened.install.now() - 30_000 };
}

/** Whether a change of the settings of the rules waits. */
async function waits(opened: Owned): Promise<boolean> {
  return ((await opened.install.database.readDomainCheck())?.rules_changed_at ?? null) !== null;
}

async function problems(opened: Owned): Promise<string[]> {
  return (await opened.install.database.listProblems("2000-01-01")).map((problem) => problem.kind);
}

describe("followRules", () => {
  // Drift: the reason of the whole file. The provider must have been handed the values stored after the change, and the change must stop waiting once a later try found the rules standing, or every run would read the provider for good.
  test("a changed setting is written to the provider's rules, and waits until a try that confirms finds them standing", async () => {
    const opened = await openOwned();
    const rules = fakeRules();
    await changed(opened, { outside_pages: "allowed" });

    expect([await waits(opened), await followRules(opened.install, rules), await waits(opened)]).toEqual([true, { carried: true }, true]);
    // A try that comes at once finds the rules standing too, and is trusted with nothing: its read may be of before the write.
    expect([await followRules(opened.install, rules, { quietSince: opened.install.now() - 30_000 }), await waits(opened)]).toEqual([{ carried: true }, true]);
    expect([await followRules(opened.install, rules, aMinuteOn(opened)), await waits(opened), rules.held]).toEqual([{ carried: true }, false, { outside_pages: "allowed", search_engines_allowed: false }]);
    expect([rules.pushed.length, await problems(opened)]).toEqual([3, []]);
  });

  // Drift: a setting changed and put back at once. The second try reads the rules as they were before the first one's write, finds them standing, and writes nothing: the provider keeps the other state.
  // A try that let the mark go there would leave the rules against the setting with nothing waiting, until the next change or a repair.
  test("a setting put back at once, whose try reads the rules of before the first write, leaves the change waiting, and the try that confirms writes the rules; the mark goes with the one after it", async () => {
    const opened = await openOwned();
    const rules = fakeRules();
    rules.held = BLOCKED;
    await changed(opened, { outside_pages: "allowed" });
    await followRules(opened.install, rules);
    rules.trails = BLOCKED;
    await changed(opened, { outside_pages: "blocked" });

    expect([await followRules(opened.install, rules), rules.held?.outside_pages, await waits(opened)]).toEqual([{ carried: true }, "allowed", true]);
    expect([await followRules(opened.install, rules, aMinuteOn(opened)), rules.held?.outside_pages, await waits(opened)]).toEqual([{ carried: true }, "blocked", true]);
    expect([await followRules(opened.install, rules, aMinuteOn(opened)), rules.held?.outside_pages, await waits(opened)]).toEqual([{ carried: true }, "blocked", false]);
  });

  // Drift: a try that confirms is trusted for its read alone. One that found the rules standing over settings that changed while it read would let go of a change it never compared.
  test("a try that confirms, and finds the rules standing while the setting changes, leaves the change waiting", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      if (earlier === 1) await changed(opened, { search_engines_allowed: true });

      return undefined;
    });
    await changed(opened, { outside_pages: "allowed" });
    await followRules(opened.install, rules);

    expect([await followRules(opened.install, rules, aMinuteOn(opened)), rules.held, await waits(opened)]).toEqual([{ carried: true }, { outside_pages: "allowed", search_engines_allowed: true }, true]);
  });

  // Drift: a provider that keeps no such rules has nothing a later run could read. A change left waiting there would have every run ask for good.
  test("where the provider keeps no such rules, a change waits no more after the first try", async () => {
    const opened = await openOwned();
    await changed(opened, { outside_pages: "allowed" });
    const none: RulesFollow = { holdsKey: () => true, push: async () => ({ ok: true, rules: "none" }) };

    expect([await followRules(opened.install, none), await waits(opened)]).toEqual([{ carried: true }, false]);
  });

  // Drift: a try that began with nothing waiting and left a mark behind would have the scheduled run call the provider for a change nobody made, and a refusal of it would note a problem of a domain that is in order.
  test("with no change waiting the provider is asked nothing, and nothing waits after", async () => {
    const opened = await openOwned();
    const rules = fakeRules(() => "key_refused");
    await changed(opened, { trash_days: 9, block_bots: "on" });

    expect([await followRules(opened.install, rules), rules.pushed, await waits(opened), await problems(opened)]).toEqual([{ carried: true }, [], false, []]);
  });

  const refusals: readonly { readonly refusal: FollowRefusal; readonly noted: boolean }[] = [
    { refusal: "key_refused", noted: true },
    { refusal: "lacks_right", noted: true },
    { refusal: "not_made", noted: true },
    { refusal: "unreachable", noted: false },
  ];

  // Drift: every refusal leaves the stored setting as it is and the change waiting. One that no later try mends is a problem of the domain; one that mends itself is none.
  test.each(refusals)("a try answered $refusal leaves the change waiting", async ({ refusal, noted }) => {
    const opened = await openOwned();
    await changed(opened, { search_engines_allowed: true });

    expect(await followRules(opened.install, fakeRules(() => refusal))).toEqual({ carried: false, why: refusal });
    expect([await waits(opened), (await opened.install.database.readSettings())?.search_engines_allowed, await problems(opened)]).toEqual([true, true, noted ? ["rules_not_carried"] : []]);
  });

  // Drift: two changes close together. Rules written while another admin changes the setting back are stale the moment they land; settled as they are, the provider would keep them.
  test("a setting that changed while the rules were written is carried again, so the provider ends with the latest", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      if (earlier === 0) await changed(opened, { outside_pages: "blocked", search_engines_allowed: true });

      return undefined;
    });
    await changed(opened, { outside_pages: "allowed" });

    expect([await followRules(opened.install, rules), rules.held, await waits(opened)]).toEqual([{ carried: true }, { outside_pages: "blocked", search_engines_allowed: true }, true]);
  });

  // Drift: two saves whose writes land out of order. The older try's write lands after the newer try's, so the provider holds the older values until the scheduled run, unless the older try sees that its values are stale.
  test("an older try whose write lands after a newer one's writes the stored values again", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      if (earlier > 0) return undefined;

      await changed(opened, { outside_pages: "blocked" });
      await followRules(opened.install, fakeRules());

      return undefined;
    });
    await changed(opened, { outside_pages: "allowed" });

    expect([await followRules(opened.install, rules), rules.held?.outside_pages, rules.pushed.length, await waits(opened)]).toEqual([{ carried: true }, "blocked", 2, true]);
  });

  // Drift: a setting that changes on every try. Nothing more is tried in this request, so the change must go on waiting for the scheduled run.
  test("a setting that changes again on the second try is left waiting", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      await changed(opened, { search_engines_allowed: earlier === 0 });

      return undefined;
    });
    await changed(opened, { outside_pages: "allowed" });

    expect([await followRules(opened.install, rules), rules.pushed.length, await waits(opened)]).toEqual([{ carried: false, why: "changed_again" }, 2, true]);
  });

  // Drift: an install that keeps no run of its domain has no row to remember a change by, so the scheduled run never learns that one waits. A try that failed there must be noted, or nobody is ever told.
  test("on an install that keeps no run of its domain the rules are written all the same, and a try with no answer is noted", async () => {
    const [taken, unanswered] = [await openOwned(), await openOwned()];
    const rules = fakeRules();
    await taken.install.database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: taken.owner, at: taken.install.now() });

    expect([await followRules(taken.install, rules), rules.held?.outside_pages, await problems(taken)]).toEqual([{ carried: true }, "allowed", []]);
    expect([await followRules(unanswered.install, fakeRules(() => "unreachable")), await problems(unanswered)]).toEqual([{ carried: false, why: "forgotten" }, ["rules_not_carried"]]);
  });
});

describe("followRules, on an install that keeps its first run of the domain while the provider is asked", () => {
  // Drift: the try began with no run kept, so it holds no mark. A refusal that queued nothing because of that would leave the change out of every later run, though the install can remember it by now.
  test("a refused try leaves the change waiting for the scheduled run, with nothing noted for a provider that gave no answer", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async () => {
      await opened.install.database.keepDomainCheck({ ran_at: opened.install.now(), by: opened.owner, run: "check", pieces: [] }, {});

      return "unreachable" as const;
    });
    await opened.install.database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: opened.owner, at: opened.install.now() });

    expect([await followRules(opened.install, rules), await waits(opened), await problems(opened)]).toEqual([{ carried: false, why: "unreachable" }, true, []]);
  });

  // Drift: the same try, taken by the provider, while a later change was stored and carried in the run kept meanwhile. A try that took the provider's answer for the end would leave the rules of the older values until the scheduled run.
  test("a try the provider took after a later change was carried writes the stored values again", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      if (earlier > 0) return undefined;

      await changed(opened, { outside_pages: "blocked" });
      await followRules(opened.install, fakeRules());

      return undefined;
    });
    await opened.install.database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: opened.owner, at: opened.install.now() });

    expect([await followRules(opened.install, rules), rules.held?.outside_pages, await waits(opened)]).toEqual([{ carried: true }, "blocked", true]);
  });
});

describe("followRules, when an older try ends after a newer one", () => {
  // Drift: the older try wrote one rule and failed at the other, after the newer try had carried the change. A refusal that set no mark would leave the provider with half of the older rules and a mark no later than the newer try's own.
  test("an older try that the provider refused part of the way leaves the change waiting again", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async () => {
      await changed(opened, { outside_pages: "blocked" });
      await followRules(opened.install, fakeRules());

      return "unreachable" as const;
    });
    await changed(opened, { outside_pages: "allowed" });

    expect([await followRules(opened.install, rules), await waits(opened)]).toEqual([{ carried: false, why: "unreachable" }, true]);
  });

  // Drift: the same order on an install that keeps no run of its domain, where no mark can say that a try's values are stale. A try that took the provider's answer for the end would leave the rules of the older values for good.
  test("with no run kept, an older try the provider took after a newer save writes the stored values again", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      if (earlier > 0) return undefined;

      await opened.install.database.changeSettings({ outside_pages: "blocked" }, { as: "person", by: opened.owner, at: opened.install.now() });
      await followRules(opened.install, fakeRules());

      return undefined;
    });
    await opened.install.database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: opened.owner, at: opened.install.now() });

    expect([await followRules(opened.install, rules), rules.held?.outside_pages, rules.pushed.length, await problems(opened)]).toEqual([{ carried: true }, "blocked", 2, []]);
  });

  // Drift: there, a setting that is stale on every try has no row to wait in. Reported as carried, the rules would differ from the settings with nobody told.
  test("with no run kept, values that are stale on every try are noted as a problem", async () => {
    const opened = await openOwned();
    const rules = fakeRules(async (earlier) => {
      await opened.install.database.changeSettings({ search_engines_allowed: earlier === 0 }, { as: "person", by: opened.owner, at: opened.install.now() });

      return undefined;
    });
    await opened.install.database.changeSettings({ outside_pages: "allowed" }, { as: "person", by: opened.owner, at: opened.install.now() });

    expect([await followRules(opened.install, rules), rules.pushed.length, await problems(opened)]).toEqual([{ carried: false, why: "forgotten" }, 2, ["rules_not_carried"]]);
  });
});

describe("a save on the Settings screen", () => {
  const settingsOf = async (opened: Awaited<ReturnType<typeof openConsole>>): Promise<readonly string[]> => {
    const answer = (await (await opened.get("/data/settings")).json()) as { readonly rows: readonly { readonly key: string; readonly repair: boolean }[] };

    return answer.rows.filter((row) => row.repair).map((row) => row.key);
  };

  // Drift: the screen saves through this route. One that carried on every save would call the provider for a setting no rule is written from, and one that never carried would leave the rules waiting for a repair the screen no longer asks for.
  test("carries a setting the rules are written from, and asks the provider nothing for any other", async () => {
    const rules = fakeRules();
    const opened = await openConsole("", usualPlug(), { rules });
    await opened.base.install.database.keepDomainCheck({ ran_at: opened.base.install.now(), by: opened.base.owner, run: "repair", pieces: [] }, {});
    opened.base.clock.now += 1;

    const other = await opened.change("/data/settings", { texts: { trash_days: "9", block_bots: "on" } });
    const afterOther = [...rules.pushed];
    const saved = await opened.change("/data/settings", { texts: { outside_pages: "allowed" } });

    expect([other.status, afterOther, saved.status, rules.pushed, await waits(opened.base)]).toEqual([200, [], 200, [{ outside_pages: "allowed", search_engines_allowed: false }], true]);
  });

  // Drift: a save is answered as saved whatever the provider says, since the setting is stored: a refusal is a problem of the domain, never a refusal of the save.
  test("is answered as saved where the provider refuses, with the change left waiting and noted", async () => {
    const opened = await openConsole("", usualPlug(), { rules: fakeRules(() => "lacks_right") });
    await opened.base.install.database.keepDomainCheck({ ran_at: opened.base.install.now(), by: opened.base.owner, run: "repair", pieces: [] }, {});
    opened.base.clock.now += 1;
    const saved = await opened.change("/data/settings", { texts: { search_engines_allowed: "on" } });

    expect([saved.status, await waits(opened.base), await problems(opened.base)]).toEqual([200, true, ["rules_not_carried"]]);
  });

  // Drift: a save must stay cheap. On a host that holds a request open after its answer, a save that waited for the provider would make the person wait for every call to it.
  test("is answered without waiting for the provider, on a host that holds the request open, and the rules are written all the same", async () => {
    const gate = Promise.withResolvers<undefined>();
    const rules = fakeRules(() => gate.promise);
    const opened = await openConsole("", usualPlug(), { rules });
    await opened.base.install.database.keepDomainCheck({ ran_at: opened.base.install.now(), by: opened.base.owner, run: "repair", pieces: [] }, {});
    opened.base.clock.now += 1;
    const left: Promise<unknown>[] = [];
    const headers = { ...opened.base.proof, Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
    const save = new Request(`${ORIGIN}/data/settings`, { method: "POST", headers, body: JSON.stringify({ texts: { outside_pages: "allowed" } }) });

    const saved = await opened.fetch(save, (work) => left.push(work));
    const answered = [saved.status, left.length, rules.held];
    gate.resolve(undefined);
    await Promise.all(left);

    expect([answered, rules.held?.outside_pages]).toEqual([[200, 1, undefined], "allowed"]);
  });

  // Drift: the line that sends a person to Domain to press Repair. It must stay on every setting a repair alone carries, and go from the ones the install carries by itself; on an install with no key a repair carries all three, as before.
  test("marks as waiting for a repair only the settings the install does not carry by itself", async () => {
    const carried = await settingsOf(await openConsole("", usualPlug(), { rules: fakeRules() }));
    const noKey = await settingsOf(await openConsole("", usualPlug(), { rules: fakeRules(undefined, false) }));

    expect([carried, noKey]).toEqual([["block_bots"], ["outside_pages", "search_engines_allowed", "block_bots"]]);
  });
});
