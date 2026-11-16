// The sign-out of everyone: who may ask, what ends the logins, and when the audit log says it was done.
// Without these a press could be written as done while every login lives on, or end every login for a token that manages only its own sites.

import { describe, expect, test } from "bun:test";

import { type EndLogins, signEveryoneOut } from "../../src/actions/sign-out";
import { ADMIN, makeWorld, OWNER, type World } from "./support/actions-fixture";

/** What a refused try answers. */
type Refusal = Extract<Awaited<ReturnType<EndLogins>>, { readonly ok: false }>["refusal"];

/** Every refusal of the place the logins are kept. */
const REFUSALS: readonly Refusal[] = ["no_key", "key_refused", "lacks_right", "unreachable", "not_made"];

/** The entries of the sign-out in the audit log, each as who and what. */
async function entries(world: World): Promise<unknown[]> {
  const listed = await world.install.database.listAudit({ limit: 100 });

  return listed.filter((entry) => entry.action === "signed_everyone_out").map(({ by, detail }) => ({ by, detail }));
}

/** A way to end the logins that keeps, for each time it was asked, the entries the log held at that moment. */
function ending(world: World, answer: Awaited<ReturnType<EndLogins>>): { readonly end: EndLogins; readonly asked: unknown[][] } {
  const asked: unknown[][] = [];

  return {
    end: async () => {
      asked.push(await entries(world));

      return answer;
    },
    asked,
  };
}

describe("signEveryoneOut", () => {
  // Drift: the entry is the only trace of who ended every login; written before the logins ended it would tell of a sign-out that never was.
  test("ends the logins once, and only then writes one entry of who asked", async () => {
    const world = await makeWorld();
    const { end, asked } = ending(world, { ok: true });

    // The log held no entry yet when the logins were ended.
    expect([await signEveryoneOut(world.install, ADMIN, end), asked, await entries(world)]).toEqual([{ ok: true }, [[]], [{ by: ADMIN.holder, detail: {} }]]);
  });

  // Drift: a press the provider refused would read as done, and the person would trust that a lost laptop is logged out.
  test.each(REFUSALS)("a try refused as %s answers that the logins were not ended, about that reason, and writes nothing", async (refusal) => {
    const world = await makeWorld();
    const { end } = ending(world, { ok: false, refusal });

    expect([await signEveryoneOut(world.install, ADMIN, end), await entries(world)]).toEqual([{ ok: false, code: "logins_not_ended", about: refusal }, []]);
  });

  // Drift: a host with no provider behind it would answer the press as done.
  test("an install with no way to end logins answers so, and writes nothing", async () => {
    const world = await makeWorld();

    expect([await signEveryoneOut(world.install, ADMIN, undefined), await entries(world)]).toEqual([{ ok: false, code: "logins_not_ended", about: "no_provider" }, []]);
  });

  // Drift: a publisher's token would log every person out of the dashboard.
  test("a publisher is refused before anything is asked of the provider", async () => {
    const world = await makeWorld();
    const { end, asked } = ending(world, { ok: true });

    expect([await signEveryoneOut(world.install, OWNER, end), asked, await entries(world)]).toEqual([{ ok: false, code: "not_allowed" }, [], []]);
  });
});
