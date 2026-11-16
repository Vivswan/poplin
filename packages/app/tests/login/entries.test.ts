// The Activity line of a login: how often the database is asked, and what a database that refuses the line costs.

import { expect, test } from "bun:test";

import type { Login } from "@poplin/core/src/auth/logins";

import { createEntries } from "../../src/login/entries";
import { openOwned } from "../console/support/install";

/** A second user of the test's install. */
const BO = "bo@example.com" as Login;

/** Open an install whose calls of `noteLogin` are counted, and what writes its logins. */
async function openEntries(): Promise<{ readonly opened: Awaited<ReturnType<typeof openOwned>>; readonly asked: () => number; readonly reported: unknown[]; readonly entered: ReturnType<typeof createEntries> }> {
  const opened = await openOwned();
  const { database } = opened.install;
  const write = database.noteLogin.bind(database);
  let asked = 0;
  database.noteLogin = (login, entered) => {
    asked += 1;

    return write(login, entered);
  };
  const reported: unknown[] = [];

  return { opened, asked: () => asked, reported, entered: createEntries(opened.install, (error) => reported.push(error)) };
}

async function loginsOf(opened: Awaited<ReturnType<typeof openOwned>>): Promise<readonly (readonly [string, number])[]> {
  return (await opened.audit()).filter((entry) => entry.action === "login").map((entry) => [entry.by, entry.at] as const);
}

// Drift: every page of a login would ask the database, which a free plan counts, or a second instance would write the line of a login a first one wrote.
test("one login asks the database once on an instance, and a second instance that meets it writes nothing", async () => {
  const { opened, asked, entered } = await openEntries();
  const { owner, clock, install } = opened;
  const since = clock.now - 2000;
  for (let page = 0; page < 5; page += 1) await entered({ email: owner, since });
  const other = createEntries(install, () => undefined);
  await other({ email: owner, since });
  await other({ email: BO, since });
  const first = clock.now;
  clock.now += 5000;
  await entered({ email: owner, since: clock.now - 1000 });
  await entered({ email: owner, since });

  expect([asked(), await loginsOf(opened)]).toEqual([
    4,
    [
      [owner, clock.now],
      [BO, first],
      [owner, first],
    ],
  ]);
});

// Drift: a login the provider dated a moment ahead of this clock would be written before its own start, and every instance that met it would write it again.
test("a login dated ahead of the clock is written at its own moment, once", async () => {
  const { opened, entered } = await openEntries();
  const since = opened.clock.now + 20_000;
  await entered({ email: opened.owner, since });
  await createEntries(opened.install, () => undefined)({ email: opened.owner, since });

  expect(await loginsOf(opened)).toEqual([[opened.owner, since]]);
});

// Drift: a login at work for hours would be asked about, or written, on every page; or an instance would never learn that somebody has logged in, and ask at each one.
test("a login that began over five minutes ago writes nothing, and its instance asks once whether anybody has logged in", async () => {
  const { opened, asked, entered } = await openEntries();
  const { database } = opened.install;
  await database.appendAudit({ action: "login", detail: {} }, { as: "person", by: BO, at: opened.clock.now });
  const has = database.hasLoggedIn.bind(database);
  let questions = 0;
  database.hasLoggedIn = () => {
    questions += 1;

    return has();
  };
  for (let page = 0; page < 4; page += 1) await entered({ email: opened.owner, since: opened.clock.now - 300_001 });

  expect([asked(), questions, await loginsOf(opened)]).toEqual([0, 1, [[BO, opened.clock.now]]]);
});

// Drift: pages a browser asks together, as tabs it restores do, would each send the login's statement: the log would hold one line, and the day's rows would pay for every tab.
test("pages that arrive together under one login share one statement", async () => {
  const { opened, asked, entered } = await openEntries();
  const since = opened.clock.now - 1000;
  await Promise.all(Array.from({ length: 8 }, () => entered({ email: opened.owner, since })));
  await entered({ email: opened.owner, since });

  expect([asked(), await loginsOf(opened)]).toEqual([1, [[opened.owner, opened.clock.now]]]);
});

// Drift: of two logins of one person whose statements are out together, the older one finishing last would be the one remembered, and every later page of the newer login would ask again.
test("the newest login noted stays noted when an older one's statement finishes after it", async () => {
  const { opened, asked, entered } = await openEntries();
  const { database } = opened.install;
  const write = database.noteLogin;
  const held: (() => void)[] = [];
  database.noteLogin = async (login, at) => {
    await new Promise<void>((release) => held.push(release));

    return write(login, at);
  };
  const [older, newer] = [opened.clock.now - 2000, opened.clock.now - 1000];
  const pages = [entered({ email: opened.owner, since: older }), entered({ email: opened.owner, since: newer })];
  await Bun.sleep(0);
  held[1]?.();
  await pages[1];
  held[0]?.();
  await pages[0];
  database.noteLogin = write;
  await entered({ email: opened.owner, since: newer });

  expect([held.length, asked()]).toEqual([2, 2]);
});

// Drift: an answer of "nobody yet" that comes back after a login was written would be believed: pages of two people would each ask, and a later line the database refused would shut out a person where it should be given up.
test("older logins of two people share one question, and its late answer does not unlearn a login written meanwhile", async () => {
  const { opened, asked, entered } = await openEntries();
  const { database } = opened.install;
  const answers: ((found: boolean) => void)[] = [];
  database.hasLoggedIn = () => new Promise<boolean>((answer) => answers.push(answer));
  const old = opened.clock.now - 400_000;
  const pages = [entered({ email: opened.owner, since: old }), entered({ email: BO, since: old })];
  await entered({ email: BO, since: opened.clock.now - 1000 });
  for (const answer of answers) answer(false);
  await Promise.all(pages);
  database.noteLogin = () => Promise.reject(new Error("the database is away"));
  const later = await entered({ email: opened.owner, since: opened.clock.now - 500 }).then(
    () => "given up",
    () => "refused",
  );

  expect([answers.length, asked(), later, await loginsOf(opened)]).toEqual([1, 1, "given up", [[BO, opened.clock.now]]]);
});

// Drift: the first login's refused line would stop the person only for five minutes. After them the same login would be let in with no line, and the setup page would stay open behind a person who is in.
test("the first login ever is refused for as long as its line is, however old the login grows, and is written once the database takes it", async () => {
  const { opened, entered } = await openEntries();
  const { database } = opened.install;
  const write = database.noteLogin;
  const since = opened.clock.now - 1000;
  const outcomes: string[] = [];
  const open = async (): Promise<void> => {
    await entered({ email: opened.owner, since }).then(
      () => outcomes.push("let in"),
      () => outcomes.push("refused"),
    );
  };
  database.noteLogin = () => Promise.reject(new Error("the database is away"));
  await open();
  opened.clock.now += 400_000;
  await open();
  database.noteLogin = write;
  await open();

  expect([outcomes, await loginsOf(opened), await database.hasLoggedIn()]).toEqual([["refused", "refused", "let in"], [[opened.owner, opened.clock.now]], true]);
});

// Drift: a database that refused the first login's line would let the person in with the setup page still open; one that refused a later line would shut a person out over a record, or lose the line without a word.
test("a refused line stops the first login ever, and after it is given up with a report and a noted problem, and not tried again", async () => {
  const { opened, reported, entered } = await openEntries();
  const { database } = opened.install;
  const write = database.noteLogin;
  const fault = new Error("the database is away");
  const since = opened.clock.now - 1000;
  database.noteLogin = () => Promise.reject(fault);
  const first = await entered({ email: opened.owner, since }).then(
    () => "let in",
    (error: unknown) => error,
  );
  database.noteLogin = write;
  await entered({ email: opened.owner, since });
  database.noteLogin = () => Promise.reject(fault);
  await entered({ email: BO, since });
  database.noteLogin = write;
  await entered({ email: BO, since });
  const problems = await database.listProblems("2000-01-01");

  expect([first, reported, await loginsOf(opened), problems.map((problem) => problem.kind)]).toEqual([
    fault,
    [fault],
    [[opened.owner, opened.clock.now]],
    ["login_unwritten"],
  ]);
});

// Drift: the sweep removes a login's line once it is over 90 days old. An instance that then read the log as one nobody logged in to would write the old login a second time, and shut the person out where the database refuses a line.
test("a login whose line the sweep removed writes no second line, and a line the database refuses is still given up, not the person", async () => {
  const { opened, asked } = await openEntries();
  const { database } = opened.install;
  const { owner, clock } = opened;
  const since = clock.now;
  await database.noteLogin(owner, { since, at: since });
  clock.now += 100 * 86_400_000;
  await database.appendAudit({ action: "domain_synced", detail: {} }, { as: "person", by: owner, at: clock.now - 1000 });
  await database.sweepRunOut(clock.now);
  const kept = await loginsOf(opened);
  const entered = createEntries(opened.install, () => undefined);
  await entered({ email: owner, since });
  const written = asked();
  database.noteLogin = () => Promise.reject(new Error("the database is away"));
  const later = await createEntries(opened.install, () => undefined)({ email: BO, since: clock.now - 500 }).then(
    () => "given up",
    () => "refused",
  );

  expect([kept, written, later, await loginsOf(opened), await database.hasLoggedIn()]).toEqual([[], 1, "given up", [], true]);
});
