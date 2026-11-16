// The data of the Usage screen: what the install holds and has answered today, each beside the limit a setting or the host's free plan gives it.
//
//   GET /usage   the stored bytes, the sites, the sites in the trash, the files, the day's requests, and the rows the database read and wrote on the day
//
// A line is poplin's own number until the host gives its own figure for it. The host's figures of the account add their own lines.
//
//   line             poplin's own                             with the host's figures
//   stored           the bytes the sites hold                 the same, and `host_stored` beside it
//   requests         the sites' requests against the setting  the same, and `host_requests` beside it
//   rows_read        counted by the install, `about`          the host's figure
//   rows_written     counted by the install, `about`          the host's figure
//   storage_writes   no line                                  the host's figure of the month
//   storage_reads    no line                                  the host's figure of the month

import { readConfig } from "@poplin/core/src/actions/config";
import { sizeBytes } from "@poplin/core/src/records/settings";
import { dayOf } from "@poplin/core/src/records/views";
import { Hono } from "hono";

import { refused, type Shared } from "./data";
import type { Keyed } from "./key/records";
import type { HostFigures, UsageHost } from "./usage/records";

/** One thing the install or its account has used. */
interface Line {
  /** What is counted. */
  readonly what: "stored" | "sites" | "trashed" | "files" | "requests" | "rows_read" | "rows_written" | "host_requests" | "host_stored" | "storage_writes" | "storage_reads";

  /** How much. */
  readonly used: number;

  /** The most it may be, or `null` where a setting sets no limit or nothing bounds it. */
  readonly limit: number | null;

  /** The key of the setting that holds the limit, or `null` where no setting does. */
  readonly setting: "max_total_size" | "max_sites" | "requests_per_day" | null;

  /** Whether `used` is the install's own count, which can read low. */
  readonly about: boolean;

  /** The host's own page of this number, or `null` where it has none. */
  readonly link: string | null;
}

/** Why the kept key gave no figures, where the screen says so: an install without a key says nothing. */
type Refusal = Exclude<Extract<Keyed<HostFigures>, { readonly ok: false }>["refusal"], "no_key">;

/** What the screen says of the host's figures: when they were read, or why the kept key gave none, with the right it lacks where that is why. `null` for an install that keeps no key. */
type Official = { readonly at: number } | { readonly refusal: Refusal; readonly right: string | null } | null;

/** A line of the host's own figure, against the free plan's limit; none where the host gave no figure. */
function hostLine(what: Line["what"], used: number | undefined, limit: number, link: string): Line[] {
  return used === undefined ? [] : [{ what, used, limit, setting: null, about: false, link }];
}

/** A line of rows of the database: the host's figure, or else the install's own count. */
function rowsLine(what: "rows_read" | "rows_written", counts: { readonly own: number; readonly host: number | undefined }, limit: number, link: string): Line {
  return { what, used: counts.host ?? counts.own, limit, setting: null, about: counts.host === undefined, link };
}

function officialOf(answer: Keyed<HostFigures>): Official {
  if (answer.ok) return { at: answer.value.at };

  if (answer.refusal === "no_key") return null;

  return { refusal: answer.refusal, right: answer.right ?? null };
}

/** Ask the host for its figures. A host that reads none answers as an install without a key does. */
async function askHost(host: UsageHost, now: number): Promise<Keyed<HostFigures>> {
  return host.official === undefined ? { ok: false, refusal: "no_key" } : host.official(now);
}

/** The Usage screen's data route. `stored` is counted in bytes, and the day's numbers are those of `day`, a UTC date. */
export const usageRoutes = new Hono<Shared>().get("/usage", async (context) => {
  const { install, actor } = context.get("asker");
  const config = await readConfig(install, actor);
  if (!config.ok) return refused(context, config);

  const { values } = config;
  const { usage: host } = context.get("host");
  const now = install.now();
  const day = dayOf(now);
  const [totals, use, answer] = await Promise.all([install.database.readTotals(), install.database.readDayUse(day), askHost(host, now)]);
  const figures: Partial<HostFigures> = answer.ok ? answer.value : {};
  const unwritten = host.unwrittenRows?.(day) ?? { read: 0, written: 0 };
  const { limits, links } = host;
  const lines: readonly Line[] = [
    { what: "stored", used: totals.bytes, limit: sizeBytes(values.max_total_size), setting: "max_total_size", about: false, link: figures.storedBytes === undefined ? links.storage : null },
    ...hostLine("host_stored", figures.storedBytes, limits.storedBytes, links.storage),
    { what: "sites", used: totals.sites, limit: values.max_sites === "none" ? null : values.max_sites, setting: "max_sites", about: false, link: null },
    { what: "trashed", used: totals.trashed_sites, limit: null, setting: null, about: false, link: null },
    { what: "files", used: totals.files, limit: null, setting: null, about: false, link: null },
    { what: "requests", used: use.requests, limit: values.requests_per_day, setting: "requests_per_day", about: false, link: figures.requests === undefined ? links.requests : null },
    ...hostLine("host_requests", figures.requests, limits.requestsPerDay, links.requests),
    rowsLine("rows_read", { own: use.rows.read + unwritten.read, host: figures.rowsRead }, limits.rowsReadPerDay, links.database),
    rowsLine("rows_written", { own: use.rows.written + unwritten.written, host: figures.rowsWritten }, limits.rowsWrittenPerDay, links.database),
    ...hostLine("storage_writes", figures.storageWrites, limits.storageWritesPerMonth, links.storage),
    ...hostLine("storage_reads", figures.storageReads, limits.storageReadsPerMonth, links.storage),
  ];

  return context.json({ ok: true as const, day, host: host.name, official: officialOf(answer), lines });
});
