// The Usage screen's route: each thing the install has used, beside the limit its setting gives.

import { expect, test } from "bun:test";

import { changeConfig } from "@poplin/core/src/actions/config";
import { deleteSite } from "@poplin/core/src/actions/delete";
import { dayOf } from "@poplin/core/src/records/views";

import { openConsole } from "./support/console";

// Drift: a number would be set against another setting's limit, the trash would be left out of the sites, or the requests of another day would be counted.
test("counts the stored bytes, the sites, the trash, the files, and today's requests against their limits", async () => {
  const opened = await openConsole();
  const { install, owner, publish, clock } = opened.base;
  const actor = { scope: "admin", holder: owner } as const;
  const kept = await publish("field-notes");
  const trashed = await publish("old-draft");
  await deleteSite(install, actor, { site: trashed.id });
  await changeConfig(install, actor, { max_sites: 5, max_total_size: { count: 2, unit: "MB" } });
  const today = dayOf(clock.now);
  await install.database.addRequests({ day: today, site: kept.id, requests: 1200, views: 40 });
  await install.database.addRequests({ day: dayOf(clock.now - 86_400_000), site: kept.id, requests: 9000, views: 1 });
  const totals = await install.database.readTotals();

  expect(await (await opened.get("/data/usage")).json()).toEqual({
    ok: true,
    day: today,
    lines: [
      { what: "stored", used: totals.bytes, limit: 2_000_000, setting: "max_total_size" },
      { what: "sites", used: 2, limit: 5, setting: "max_sites" },
      { what: "trashed", used: 1, limit: null, setting: null },
      { what: "files", used: totals.files, limit: null, setting: null },
      { what: "requests", used: 1200, limit: 100_000, setting: "requests_per_day" },
    ],
  });
});

// Drift: an install with no limit on its sites would show a limit of nothing as a number.
test("gives the sites no limit while the setting is none", async () => {
  const opened = await openConsole();
  const answer = (await (await opened.get("/data/usage")).json()) as { readonly lines: readonly Readonly<Record<string, unknown>>[] };

  expect(answer.lines.find((line) => line.what === "sites")).toEqual({ what: "sites", used: 0, limit: null, setting: "max_sites" });
});
