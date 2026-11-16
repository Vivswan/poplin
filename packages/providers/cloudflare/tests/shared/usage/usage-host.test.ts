import { describe, expect, test } from "bun:test";

import { createUsageHost } from "../../../src/shared/usage/usage-host";
import { withFake } from "../install/support/fake-cloudflare";
import { refusal } from "../install/support/replies";

/** A made-up account id. */
const ACCOUNT = "0123456789abcdef0123456789abcdef";

/** The moment the first reading is made at. */
const NOW = Date.UTC(2026, 10, 15, 14, 30);

/** A minute in milliseconds. */
const MINUTE = 60_000;

/** The questions one reading of the figures sends: six queries and the list of the running jobs. */
const QUERIES = 7;

/** An instance that counted no rows. */
const NO_ROWS = { read: 0, written: 0 };

/** The rest of an install: a made-up Workflow, and a database that last said it holds 1.4 MB. */
const INSTALL = { workflow: "poplin-jobs", databaseBytes: () => 1_400_000 };

describe("Cloudflare's side of the Usage screen", () => {
  // Drift: Cloudflare's dashboard shows an account's pages under its id; a link without it, or to another product's page, would show a person a page of nothing.
  // The size of the database is the driver's own, and a host that dropped it would lose the line of an install without a key.
  test("links to the pages of the Worker's own account, and hands on the rows the driver holds for the day asked and the size of the database", () => {
    const host = createUsageHost({ accountId: ACCOUNT, unwrittenRows: (day) => (day === "2026-11-15" ? { read: 40, written: 3 } : NO_ROWS), ...INSTALL, key: undefined });

    expect([host.links, host.unwrittenRows?.("2026-11-15"), host.databaseBytes?.(), host.behindMs]).toEqual([
      {
        requests: `https://dash.cloudflare.com/${ACCOUNT}/workers-and-pages`,
        database: `https://dash.cloudflare.com/${ACCOUNT}/workers/d1`,
        storage: `https://dash.cloudflare.com/${ACCOUNT}/r2/overview`,
        jobs: `https://dash.cloudflare.com/${ACCOUNT}/workers/workflows`,
      },
      { read: 40, written: 3 },
      1_400_000,
      600_000,
    ]);
  });

  // Drift: every reading is seven outside calls; made on every opening of the screen they would spend an invocation's outside calls and Cloudflare's own rate on figures that change by the minute at best.
  test("an instance reads the figures once in five minutes, and reads them anew after", async () => {
    await withFake(
      () => Response.json({ data: { viewer: { accounts: [{ groups: [{ sum: { requests: 7 } }] }] } } }),
      async (connection, asked) => {
        const host = createUsageHost({ accountId: ACCOUNT, unwrittenRows: () => NO_ROWS, ...INSTALL, key: { connection } });
        const first = await host.official?.(NOW);
        const within = await host.official?.(NOW + 5 * MINUTE - 1);
        const callsWithin = asked.length;
        const after = await host.official?.(NOW + 5 * MINUTE);

        expect([first?.ok && first.value.at, within?.ok && within.value.at, callsWithin, after?.ok && after.value.at, asked.length]).toEqual([NOW, NOW, QUERIES, NOW + 5 * MINUTE, 2 * QUERIES]);
      },
    );
  });

  // Drift: a refusal kept as long as the figures would hide a key that was just put right for five minutes.
  test("a reading that was refused is kept for one minute only", async () => {
    await withFake(
      () => refusal(401, 1000, "Invalid API Token"),
      async (connection, asked) => {
        const host = createUsageHost({ accountId: ACCOUNT, unwrittenRows: () => NO_ROWS, ...INSTALL, key: { connection } });
        const answers = [await host.official?.(NOW), await host.official?.(NOW + MINUTE - 1)];
        const callsWithin = asked.length;
        await host.official?.(NOW + MINUTE);

        expect([answers, callsWithin, asked.length]).toEqual([[{ ok: false, refusal: "key_refused" }, { ok: false, refusal: "key_refused" }], QUERIES, 2 * QUERIES]);
      },
    );
  });

  // Drift: two openings of the screen at once would each send the seven questions, and figures read before midnight would stand as the new day's.
  test("readings asked for together are one reading, and a reading of the day before is not kept", async () => {
    await withFake(
      () => Response.json({ data: { viewer: { accounts: [{ groups: [{ sum: { requests: 7 } }] }] } } }),
      async (connection, asked) => {
        const host = createUsageHost({ accountId: ACCOUNT, unwrittenRows: () => NO_ROWS, ...INSTALL, key: { connection } });
        const lateEvening = Date.UTC(2026, 10, 15, 23, 59);
        await Promise.all([host.official?.(lateEvening), host.official?.(lateEvening + 1)]);
        const callsTogether = asked.length;
        await host.official?.(lateEvening + 2 * MINUTE);

        expect([callsTogether, asked.length]).toEqual([QUERIES, 2 * QUERIES]);
      },
    );
  });
});
