// What a login leaves behind when it could not be checked or written down: the problems the install notes, which the dashboard then shows.

import { reset } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ADMIN, ask, BINDINGS, accessHeaders, instance, logIn, problemsOf, refusingDatabase, type World, world } from "./support/install";

let w: World;

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("a login that cannot be checked or written down", () => {
  // Drift: while the team's keys cannot be had nobody gets into the dashboard, and the person who is told to try again is the only one who knows.
  test("a login while the team's keys cannot be had is told to try again and is noted", async () => {
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`);
    w.certs.down = true;
    const answer = await logIn(worker, w);

    expect([answer.status, answer.headers.get("Set-Cookie")]).toEqual([503, null]);
    expect(await problemsOf(w)).toEqual([["login_unchecked", 1, null]]);
  });

  // Drift: a later login whose entry the log refuses still lets the person in, so nothing but a line in the provider's log said the log has a gap.
  test("a login after the first whose audit entry is refused lets the person in and is noted with the failure's message", async () => {
    using warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await logIn(instance(w), w);
    const locked = { ...BINDINGS, DB: refusingDatabase(/insert into "?audit/i) };

    const later = await ask(instance(w), `${ADMIN}/login`, { headers: await accessHeaders(w) }, locked);

    expect([later.status, later.headers.get("Location"), warned.mock.calls.length]).toEqual([302, "/", 1]);
    expect(await problemsOf(w)).toEqual([["login_unwritten", 1, "the table is locked"]]);
  });
});
