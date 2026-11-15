// The data of the Usage screen: what the install holds and has answered today, each beside the limit a setting gives it.
//
//   GET /usage   the stored bytes, the sites, the sites in the trash, the files, and the day's requests

import { readConfig } from "@poplin/core/src/actions/config";
import { sizeBytes } from "@poplin/core/src/records/settings";
import { dayOf } from "@poplin/core/src/records/views";
import { Hono } from "hono";

import { refused, type Shared } from "./data";

/** One thing the install has used: how much, the most its setting lets it be, or `null` where that setting sets no limit or there is none, and the key of that setting, or `null` where no setting bounds it. */
interface Line {
  readonly what: "stored" | "sites" | "trashed" | "files" | "requests";
  readonly used: number;
  readonly limit: number | null;
  readonly setting: "max_total_size" | "max_sites" | "requests_per_day" | null;
}

/** The Usage screen's data route. `stored` is counted in bytes, and the requests are those of `day`, a UTC date. */
export const usageRoutes = new Hono<Shared>().get("/usage", async (context) => {
  const { install, actor } = context.get("asker");
  const config = await readConfig(install, actor);
  if (!config.ok) return refused(context, config);

  const { values } = config;
  const day = dayOf(install.now());
  const [totals, requests] = await Promise.all([install.database.readTotals(), install.database.readRequests(day)]);
  const lines: readonly Line[] = [
    { what: "stored", used: totals.bytes, limit: sizeBytes(values.max_total_size), setting: "max_total_size" },
    { what: "sites", used: totals.sites, limit: values.max_sites === "none" ? null : values.max_sites, setting: "max_sites" },
    { what: "trashed", used: totals.trashed_sites, limit: null, setting: null },
    { what: "files", used: totals.files, limit: null, setting: null },
    { what: "requests", used: requests.all, limit: values.requests_per_day, setting: "requests_per_day" },
  ];

  return context.json({ ok: true as const, day, lines });
});
