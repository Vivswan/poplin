// The data of the Usage screen: what the install holds and has answered today, each beside the limit a setting or the host's free plan gives it.
//
//   GET /usage   the stored bytes, the sites, the sites in the trash, the files, the day's requests, the rows the database read and wrote on the day, and the size of the database
//
// A line is poplin's own number until the host gives its own figure for it. The host's figures of the account add their own lines.
//
//   line             poplin's own                             with the host's figures
//   stored           the bytes the sites hold                 the same, and `host_stored` beside it
//   database_size    the bytes the database holds             the same, and `host_database_size` beside it
//   files            the files the sites hold                 the same, and `host_files` and `host_uploads` beside it
//   requests         the sites' requests against the setting  the same, and `host_requests`, `host_errors`, `host_stopped`, and `host_slowest` beside it
//   rows_read        counted by the install, `about`          the host's figure
//   rows_written     counted by the install, `about`          the host's figure
//   storage_writes   no line                                  the host's figure of the month
//   storage_reads    no line                                  the host's figure of the month
//   jobs_*           no line                                  the host's figures of the day's background jobs, and of the ones running
//
// Once the host answered, a figure it gave none of keeps its line with no number, so a line that was not read is told from one that reads 0.

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
  readonly what:
    | "stored"
    | "host_stored"
    | "database_size"
    | "host_database_size"
    | "sites"
    | "trashed"
    | "files"
    | "host_files"
    | "host_uploads"
    | "requests"
    | "host_requests"
    | "host_errors"
    | "host_stopped"
    | "host_slowest"
    | "rows_read"
    | "rows_written"
    | "storage_writes"
    | "storage_reads"
    | "jobs_started"
    | "jobs_done"
    | "jobs_failed"
    | "jobs_running";

  /** How much, or `null` for a figure the host was asked for and gave none of. */
  readonly used: number | null;

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

/** What the screen says of the host's figures: when they were read and how far behind that moment they run, in milliseconds, or why the kept key gave none, with the right it lacks where that is why. `null` for an install that keeps no key. */
type Official = { readonly at: number; readonly behind: number | null } | { readonly refusal: Refusal; readonly right: string | null } | null;

/** Makes the line of one of the host's own figures, against the free plan's limit or against none. */
type HostLine = (what: Line["what"], used: number | undefined, limit: number | null, link: string) => Line[];

/** The lines of the host's own figures: one for each figure once the host answered, without a number where it gave none of that figure, and no line while the host gave no figures at all. */
function hostLines(answered: boolean): HostLine {
  return (what, used, limit, link) => (answered ? [{ what, used: used ?? null, limit, setting: null, about: false, link }] : []);
}

/** The line of the size of the install's own database; none on a host that cannot tell it. */
function sizeLine(host: UsageHost): Line[] {
  const used = host.databaseBytes?.();

  return used === undefined ? [] : [{ what: "database_size", used, limit: host.limits.databaseBytes, setting: null, about: false, link: host.links.database }];
}

/** A line of rows of the database: the host's figure, or else the install's own count. */
function rowsLine(what: "rows_read" | "rows_written", counts: { readonly own: number; readonly host: number | undefined }, limit: number, link: string): Line {
  return { what, used: counts.host ?? counts.own, limit, setting: null, about: counts.host === undefined, link };
}

function officialOf(answer: Keyed<HostFigures>, host: UsageHost): Official {
  if (answer.ok) return { at: answer.value.at, behind: host.behindMs ?? null };

  if (answer.refusal === "no_key") return null;

  return { refusal: answer.refusal, right: answer.right ?? null };
}

/** Ask the host for its figures. A host that reads none answers as an install without a key does. */
async function askHost(host: UsageHost, now: number): Promise<Keyed<HostFigures>> {
  return host.official === undefined ? { ok: false, refusal: "no_key" } : host.official(now);
}

/** The Usage screen's data route. The sizes are counted in bytes, the processing time in milliseconds, and the day's numbers are those of `day`, a UTC date. */
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
  const hostLine = hostLines(answer.ok);
  const lines: readonly Line[] = [
    { what: "stored", used: totals.bytes, limit: sizeBytes(values.max_total_size), setting: "max_total_size", about: false, link: answer.ok ? null : links.storage },
    ...hostLine("host_stored", figures.storedBytes, limits.storedBytes, links.storage),
    // Asked after the database answered above, so the size is the one it had then.
    ...sizeLine(host),
    ...hostLine("host_database_size", figures.databaseBytes, limits.accountDatabaseBytes, links.database),
    { what: "sites", used: totals.sites, limit: values.max_sites === "none" ? null : values.max_sites, setting: "max_sites", about: false, link: null },
    { what: "trashed", used: totals.trashed_sites, limit: null, setting: null, about: false, link: null },
    { what: "files", used: totals.files, limit: null, setting: null, about: false, link: null },
    ...hostLine("host_files", figures.files, null, links.storage),
    ...hostLine("host_uploads", figures.unfinishedUploads, null, links.storage),
    { what: "requests", used: use.requests, limit: values.requests_per_day, setting: "requests_per_day", about: false, link: answer.ok ? null : links.requests },
    ...hostLine("host_requests", figures.requests, limits.requestsPerDay, links.requests),
    ...hostLine("host_errors", figures.errors, null, links.requests),
    ...hostLine("host_stopped", figures.stopped, null, links.requests),
    ...hostLine("host_slowest", figures.slowestMs, limits.processingMs, links.requests),
    rowsLine("rows_read", { own: use.rows.read + unwritten.read, host: figures.rowsRead }, limits.rowsReadPerDay, links.database),
    rowsLine("rows_written", { own: use.rows.written + unwritten.written, host: figures.rowsWritten }, limits.rowsWrittenPerDay, links.database),
    ...hostLine("storage_writes", figures.storageWrites, limits.storageWritesPerMonth, links.storage),
    ...hostLine("storage_reads", figures.storageReads, limits.storageReadsPerMonth, links.storage),
    ...hostLine("jobs_started", figures.jobsStarted, null, links.jobs),
    ...hostLine("jobs_done", figures.jobsDone, null, links.jobs),
    ...hostLine("jobs_failed", figures.jobsFailed, null, links.jobs),
    ...hostLine("jobs_running", figures.jobsRunning, limits.jobsAtOnce, links.jobs),
  ];

  return context.json({ ok: true as const, day, host: host.name, official: officialOf(answer, host), lines });
});
