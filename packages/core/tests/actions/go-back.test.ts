import { describe, expect, test } from "bun:test";

import { backAfterFailedStep, noteWentBack, wayBack } from "../../src/actions/go-back";
import type { Database } from "../../src/database/database";
import { OWN_SCHEMA } from "../../src/database/open";
import { dayOf } from "../../src/records/views";
import { makeWorld, NOW } from "./support/actions-fixture";

/** The update an install running 0.3.0 took by itself, from 0.2.0, with the database at this code's schema. */
const LAST = { from: "0.2.0", to: "0.3.0", schema: OWN_SCHEMA, at: NOW - 60_000 };

describe("going back after an update", () => {
  // Drift: the button goes below the running version, which no other start does. Offered after an update that changed the database, it would start code that cannot read it.
  // Offered over code a deploy put in place since, it would send the install to a version it never ran before that code.
  test.each([
    { name: "the running code is the code the last update put in place", last: LAST, running: "0.3.0", back: { to: "0.2.0", since: LAST.at } },
    { name: "the host keeps no update", last: undefined, running: "0.3.0", back: undefined },
    { name: "the code was put in place another way since", last: LAST, running: "0.4.0", back: undefined },
    { name: "the update changed the database", last: { ...LAST, schema: OWN_SCHEMA + 1 }, running: "0.3.0", back: undefined },
    { name: "the last update was itself a going back", last: { ...LAST, from: "0.3.0", to: "0.2.0" }, running: "0.2.0", back: undefined },
    { name: "the last update took the version it ran", last: { ...LAST, from: "0.3.0" }, running: "0.3.0", back: undefined },
  ])("a person is offered the version before when $name: $back", ({ last, running, back }) => {
    expect(wayBack(last, running)).toEqual(back);
  });

  // Drift: the install puts older code in place with nobody asking. After a step that was applied, or on code no update of its own brought, that code would meet a database it cannot read.
  test.each([
    { name: "a step failed and the database is at the schema of the version before", last: LAST, failed: { version: "0.3.0", stored: OWN_SCHEMA }, back: "0.2.0" },
    { name: "an earlier step of the same start was applied", last: LAST, failed: { version: "0.3.0", stored: OWN_SCHEMA + 1 }, back: undefined },
    { name: "the host keeps no update", last: undefined, failed: { version: "0.3.0", stored: OWN_SCHEMA }, back: undefined },
    { name: "the code that failed is not from the last update", last: LAST, failed: { version: "0.4.0", stored: OWN_SCHEMA }, back: undefined },
    { name: "the last update was a going back", last: { ...LAST, from: "0.3.0", to: "0.2.0" }, failed: { version: "0.2.0", stored: OWN_SCHEMA }, back: undefined },
  ])("the install goes back by itself when $name: $back", ({ last, failed, back }) => {
    expect(backAfterFailedStep(last, failed)).toEqual(back);
  });

  // Drift: nobody pressed anything when the install went back, so Activity and the Problems list are the only places that say it happened.
  test("a going back is written to the audit log with both versions, and noted as its own problem", async () => {
    const world = await makeWorld();
    await noteWentBack(world.install, { from: "0.3.0", to: "0.2.0" });
    const [entry] = await world.install.database.listAudit({ limit: 1 });
    const problems = await world.install.database.listProblems(dayOf(NOW));

    expect<unknown>({ entry: [entry?.by, entry?.action, entry?.detail], problems: problems.map(({ kind, count }) => [kind, count]) }).toEqual({
      entry: ["sweep@poplin.invalid", "update_went_back", { from: "0.3.0", to: "0.2.0" }],
      problems: [["update_went_back", 1]],
    });
  });

  // Drift: the note is written by code one schema step ahead of the database. A write that step would have changed throws: the other note must still be written, and the answer that says the install went back must not turn into a failure.
  test("a database that refuses the audit entry still takes the problem, and nothing is thrown", async () => {
    const world = await makeWorld();
    const stored = world.install.database;
    const database = { appendAudit: () => Promise.reject(new Error("no such column")), noteProblem: (problem: Parameters<Database["noteProblem"]>[0]) => stored.noteProblem(problem) } as unknown as Database;
    await noteWentBack({ database, now: world.install.now }, { from: "0.3.0", to: "0.2.0" });

    expect((await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count }) => [kind, count])).toEqual([["update_went_back", 1]]);
  });
});
