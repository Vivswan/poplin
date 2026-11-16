// What a visitor's request leaves behind when it could not be answered as asked: the problems the install notes, which the dashboard then shows.

import { reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { accessHeaders, ask, installOf, instance, OWNER, page, problemsOf, publish, tokenOf, under, type World, world } from "./support/install";

let w: World;

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("a visitor's request that meets a limit or a login that cannot be checked", () => {
  // Drift: once the day's requests are used up every site answers 429 until midnight, and nothing told the owner why. A note on each refusal would be a statement a request, on a day that already has too many.
  test("the day's limit of requests, once reached, is noted as one problem however many requests it refuses", async () => {
    const site = await publish(instance(w), await tokenOf(w, "publisher"), { name: "docs", access: "public" }, [page("<p>docs</p>")]);
    const { database } = await installOf(w);
    await database.changeSettings({ requests_per_day: 2, site_share_of_day: 100 }, { as: "person", by: OWNER, at: w.clock.now });
    // A new instance reads the settings anew.
    const worker = instance(w);
    const statuses: number[] = [];
    for (let asked = 0; asked < 5; asked += 1) statuses.push((await ask(worker, `${site.addresses.public}/`)).status);

    expect(statuses).toEqual([200, 200, 429, 429, 429]);
    expect(await problemsOf(w)).toEqual([["requests_limit_reached", 1, null]]);
  });

  // Drift: while the team's keys cannot be had no private site opens, and the owner saw nothing of it unless they were the one refused.
  test("a request under p whose token cannot be checked is noted as a login that could not be checked", async () => {
    const worker = instance(w);
    const site = await publish(worker, await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    w.certs.down = true;
    const answers = [await ask(worker, `${under(site, "p")}/`, { headers: await accessHeaders(w) }), await ask(worker, `${under(site, "p")}/`, { headers: await accessHeaders(w) })];

    expect(answers.map((answer) => answer.status)).toEqual([503, 503]);
    expect(await problemsOf(w)).toEqual([["login_unchecked", 1, null]]);
  });
});
