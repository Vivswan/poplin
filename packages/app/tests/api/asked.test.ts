import { expect, test } from "bun:test";

import type { Install } from "@poplin/core/src/actions/records";
import { dayOf } from "@poplin/core/src/records/views";
import { Hono } from "hono";

import { metered } from "../../src/api/asked";
import { ADDRESSES } from "../sites/support/layout";
import { NOW, openApi } from "./support/install";

// Drift: the listings of a request are written to the day's count after it is answered. A count that is lost lets the day pass its bound unseen, so it is noted, and the request it belongs to is still answered as it was.
test("a count of listings that cannot be written leaves the answer as it was, is reported, and is noted as a problem", async () => {
  const { database, store, clock } = await openApi();
  const install: Install = { database, store, now: () => clock.now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames };
  const reported: unknown[] = [];
  const app = new Hono().get("/lists", metered(install, (error) => reported.push(error)), async (context) => {
    for (let listing = 0; listing < 3; listing += 1) await context.var.install.store.list({ prefix: "none/" });

    return context.text("listed");
  });
  database.addStorageWrites = () => Promise.reject(new Error("the count was refused"));

  const answer = await app.request("/lists");

  expect([answer.status, await answer.text(), reported.map(String)]).toEqual([200, "listed", ["Error: the count was refused"]]);
  expect((await database.listProblems(dayOf(NOW))).map(({ kind, count, message }) => [kind, count, message])).toEqual([["count_unwritten", 1, "the count was refused"]]);
});
