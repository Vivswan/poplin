import { expect, test } from "bun:test";

import { changeConfig } from "@poplin/core/src/actions/config";

import { openDashboard } from "../support/install";

const ROW = /<tr>\s*<th scope="row">([^<]*)<\/th>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>(.*?)<\/td>\s*<\/tr>/g;

test("the stored totals and the day's requests are shown against the limits the settings hold, and the page says the count is approximate", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  const site = await opened.publish("report");
  const trashed = await opened.publish("old");
  const reserved = await opened.install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  await opened.install.database.addVersion(site.id, { number: reserved.number, keep: 3, bytes: 4_500_000_000, files: 120 }, { by: opened.owner, at: opened.clock.now });
  await opened.install.database.trashSite(trashed.id, { by: opened.owner, at: opened.clock.now });
  await opened.install.database.addRequests({ day: "2023-11-14", site: site.id, requests: 25_000 });
  await opened.install.database.addRequests({ day: "2023-11-14", site: trashed.id, requests: 5000 });

  const page = await (await opened.get("/usage")).text();

  expect(Array.from(page.matchAll(ROW), (row) => row.slice(1))).toEqual([
    ["Stored", "4.5 GB", "9 GB", '<meter min="0" max="9000000000" value="4500000000">50%</meter> 50%'],
    ["Sites, the trash included", "2", "no limit", ""],
    ["Sites in the trash", "1", "no limit", ""],
    ["Files", "120", "no limit", ""],
    ["Requests today", "30000", "100000", '<meter min="0" max="100000" value="30000">30%</meter> 30%'],
  ]);
  expect(page).toContain("Requests are counted from a sample, so today's number is approximate.");

  await changeConfig(opened.install, admin, { max_sites: 1, max_total_size: { count: 1, unit: "GB" } });
  const over = await (await opened.get("/usage")).text();

  expect(Array.from(over.matchAll(ROW), (row) => row.slice(1)).slice(0, 2)).toEqual([
    ["Stored", "4.5 GB", "1 GB", '<meter min="0" max="1000000000" value="1000000000">450%</meter> 450%'],
    ["Sites, the trash included", "2", "1", '<meter min="0" max="1" value="1">200%</meter> 200%'],
  ]);
});

test("the requests shown are those of the clock's UTC day alone", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  await opened.install.database.addRequests({ day: "2023-11-14", site: site.id, requests: 7 });

  opened.clock.now += 2 * 60 * 60 * 1000;
  const next = await (await opened.get("/usage")).text();

  expect(Array.from(next.matchAll(ROW), (row) => row.slice(1)).at(-1)).toEqual(["Requests today", "0", "100000", '<meter min="0" max="100000" value="0">0%</meter> 0%']);
});
