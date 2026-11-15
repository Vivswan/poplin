// The data of the Activity screen: one page of the audit log, the newest entry first, or the oldest first when asked, and how many entries the log holds.
//
//   GET /activity         one page; ?kind= keeps one kind of action, ?site= the entries about a site whose name then held the text, ?dir=asc the oldest first, ?size= how many entries it holds,
//                         ?after= goes on after a page in that direction, ?back= goes back to the page ahead of one
//                         a narrowed page looks at 5,000 entries of the log and no more: one that stopped there says so, and its place goes on from where it stopped
//   GET /activity/total   how many entries the log holds, counted no further back than the newest 10,000, or the newest 5,000 under ?kind= and ?site=
//   GET /activity/download        the entries under ?kind= and ?site= as a file, the newest first and 2,000 at the most, in ?format=csv or jsonl; ?after= goes on after the file before, and ?part= numbers the file's name
//   GET /activity/download/next   the place the file after one goes on from, or none when the log ends with it

import { vValidator } from "@hono/valibot-validator";
import { AUDIT_COUNT_QUERY, AUDIT_FILE_PAGE, AUDIT_QUERY, countAudit, listAudit, listAuditForFile, listAuditForScreen, nextAuditFile } from "@poplin/core/src/actions/audit-log";
import type { Install } from "@poplin/core/src/actions/records";
import { AUDIT_WINDOW } from "@poplin/core/src/database/database";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";
import * as v from "valibot";

import { FILE_WRITERS, type FileEntry, MOST_IN_FILE } from "./activity-file";
import { whatOf } from "./activity-what";
import { loginNames, refused, refuseInvalid, type Shared } from "./data";

/** How many entries one page of the log may hold, as the address names them; the first when it names none. */
const PAGE_SIZES = ["50", "100", "200"] as const;

/** How many ids the database names in one reading; a page of the log may name more sites than that. */
const IDS_AT_ONCE = 100;

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** What a file that holds fewer entries than the log says in its last line. */
const CUT_NOTE = `${MOST_IN_FILE.toLocaleString("en-US")} entries. The log holds more: download the next part.`;

/** What a narrowed file says in its last line when a reading of it stopped short with the log going on. */
const STOPPED_NOTE = `Searched ${AUDIT_WINDOW.toLocaleString("en-US")} entries of the log. It holds more: download the next part.`;

/** The place a page or a file ended or began, as the address carries it: the `seq` of an entry. */
const PLACE = v.optional(v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,15}$/), v.transform(Number)));

/** Which entries a file of the log holds: the narrowing of a page, and the place the file before ended. */
const FILE_PLACE = { kind: AUDIT_QUERY.entries.kind, site: AUDIT_QUERY.entries.site, after: PLACE };

/** What a file of the log may be asked with: its entries, its format, comma-separated when none is named, and the number its name carries when the log takes more files than one. */
const FILE_QUERY = v.strictObject({
  ...FILE_PLACE,
  format: v.optional(v.picklist(["csv", "jsonl"]), "csv"),
  part: v.optional(v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,8}$/))),
});

/** What the log's address may ask for, and nothing else: a key it does not know is refused, as the log itself refuses it. */
const PAGE_QUERY = v.strictObject({
  kind: AUDIT_QUERY.entries.kind,
  site: AUDIT_QUERY.entries.site,
  after: PLACE,
  back: PLACE,
  dir: AUDIT_QUERY.entries.dir,
  size: v.optional(v.pipe(v.picklist(PAGE_SIZES), v.transform(Number)), PAGE_SIZES[0]),
});

/** What a reading of the log answers. */
type Listed = Awaited<ReturnType<typeof listAudit>>;

/** One entry of the log. */
type Entry = Extract<Listed, { ok: true }>["entries"][number];

/** One reading of the log: its entries, and where it stopped when it is a narrowed one that came back short with the log going on. */
type Read = Extract<Listed, { ok: true }>;

/** What a page was asked with and what its reading found, as far as the places around it go. */
interface Turn {
  /** The place the page goes on after; `undefined` for the first page and a page gone back to. */
  readonly after: number | undefined;

  /** The place the page goes back from; `undefined` for a page gone on to. */
  readonly back: number | undefined;

  /** Which way `seq` runs down the list: 1 when the oldest entry is first, -1 when the newest is. */
  readonly along: 1 | -1;

  /** The page's first and last entry as the list shows them; `undefined` for a page with none. */
  readonly ends: readonly [Entry | undefined, Entry | undefined];

  /** Whether the reading found an entry more than the page holds. */
  readonly beyond: boolean;

  /** Where the reading stopped short with the log going on. */
  readonly stopped: number | undefined;
}

/** Who asks, and of which install. */
type Asker = Shared["Variables"]["asker"];

/** Which entries of the log a file is narrowed to. */
type Narrowing = Pick<v.InferOutput<typeof FILE_QUERY>, "kind" | "site">;

/** Read what the database knows of some ids, as many at a time as one reading takes. */
async function ofAll<Found>(ids: readonly SiteId[], read: (some: readonly SiteId[]) => Promise<ReadonlyMap<SiteId, Found>>): Promise<Map<SiteId, Found>> {
  const found = new Map<SiteId, Found>();
  for (let from = 0; from < ids.length; from += IDS_AT_ONCE) {
    for (const [id, one] of await read(ids.slice(from, from + IDS_AT_ONCE))) found.set(id, one);
  }

  return found;
}

/**
 * What each site the entries name is now, by the id an entry holds: its label, and the title it is listed under, `null` for a site with none. A site that is gone is left out.
 * An entry from before a new link holds an id the site gave up: it is named as the site is now. The ids are read 100 to a query, and those that are no site's the same way.
 */
async function sitesNow(install: Install, entries: readonly Entry[]): Promise<ReadonlyMap<string, { readonly label: string; readonly title: string | null }>> {
  const ids = [...new Set(entries.flatMap((entry) => (entry.site === null ? [] : [entry.site.id])))];
  const names = await ofAll(ids, (some) => install.database.getSiteNames(some));
  const now = new Map(Array.from(names, ([id, { name, title }]) => [id as string, { label: siteLabel(name, id), title }]));
  const given = ids.filter((id) => !names.has(id));
  const later = await ofAll(given, (some) => install.database.getLaterSites(some));
  for (const [earlier, site] of later) now.set(earlier, { label: siteLabel(site.name, site.id), title: site.title });

  return now;
}

/** A place beside the one a page was asked with; none where that would be before the first place an address can name. */
function beside(place: number): number | undefined {
  return place >= 1 ? place : undefined;
}

/**
 * The places the pages around a page are reached from: the one ahead of it by `back`, the one after it by `after`.
 *
 * A page gone on to came from the page ahead of it, and a page gone back to from the page after it. The other way is there when the reading found an entry more, or stopped short with the log going on: it then goes on from where it stopped.
 * A page with no entry is reached from a place still: the one beside the place it was asked with, unless that is before the first place an address can name.
 */
function placesAround({ after, back, along, ends: [first, last], beyond, stopped }: Turn): { readonly previous: number | undefined; readonly next: number | undefined } {
  if (back !== undefined) return { previous: beyond ? first?.seq : stopped, next: last?.seq ?? beside(back - along) };

  const next = beyond ? last?.seq : stopped;
  if (after === undefined) return { previous: undefined, next };

  return { previous: first?.seq ?? beside(after + along), next };
}

/** One entry as a file holds it: the moment in UTC, the name of a login that has one, and the sentence the screen shows. */
function fileEntryOf(entry: Entry, logins: Readonly<Record<string, string>>): FileEntry {
  return {
    when: new Date(entry.at).toISOString(),
    who: logins[entry.by] ?? entry.by,
    what: whatOf(entry),
    site: entry.site?.name ?? "",
    action: entry.action,
    detail: entry.detail,
  };
}

/** Whether the log holds an entry behind the last one a full file holds, or may: a narrowed reading that stopped short with the log going on has not seen its end. */
async function goesOn({ install, actor }: Asker, narrowing: Narrowing, after: number): Promise<boolean> {
  const beyond = await listAudit(install, actor, { ...narrowing, after, limit: 1 });

  return beyond.ok && (beyond.entries.length > 0 || beyond.stopped_at !== undefined);
}

/**
 * Decide how a file ends once a reading is written, if it ends there.
 *
 * @param file - the reading just written, and how many entries the file holds with it
 * @returns the file's last line, empty where it ends with the log; `undefined` while the file goes on with another reading
 */
async function endingOf(asker: Asker, narrowing: Narrowing, file: { readonly reading: Read; readonly written: number }, notes: { readonly cut: string; readonly stopped: string }): Promise<string | undefined> {
  const { entries, stopped_at: stopped } = file.reading;
  const last = entries.at(-1);
  // A short reading is the log's end, or the file's: one that stopped short leaves the rest of the log to the next file.
  if (last === undefined || entries.length < AUDIT_FILE_PAGE) return stopped === undefined ? "" : notes.stopped;

  if (file.written < MOST_IN_FILE) return undefined;

  return (await goesOn(asker, narrowing, last.seq)) ? notes.cut : "";
}

/**
 * Stream a file of the log: each reading of the log is written and handed on before the next is made, so no more than one reading is held at a time.
 *
 * @param first - the first reading, made before the answer began so that its refusal could still be answered
 * @param writer - writes the file's start, each entry as a line, and the last line of a file that holds fewer entries than the log: `cut` after a full file, `stopped` after a reading that stopped short
 * It is the platform's own stream, not the framework's streaming helper: that one closes a failed answer as if it were whole, and a cut file must not look complete.
 *
 * @returns the file's bytes; a reading that fails after the first ends the stream with an error, which a browser reports as a failed download
 */
function fileOf(
  asker: Asker,
  narrowing: Narrowing,
  first: Read,
  writer: { readonly head: string; readonly lineOf: (entry: Entry) => string; readonly cut: string; readonly stopped: string },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const state = { reading: first, written: 0 };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (writer.head !== "") controller.enqueue(encoder.encode(writer.head));
    },
    async pull(controller) {
      const { entries: reading } = state.reading;
      if (reading.length > 0) controller.enqueue(encoder.encode(reading.map(writer.lineOf).join("")));

      state.written += reading.length;
      const ending = await endingOf(asker, narrowing, state, writer);
      if (ending !== undefined) {
        if (ending !== "") controller.enqueue(encoder.encode(ending));

        controller.close();

        return;
      }

      const next = await listAuditForFile(asker.install, asker.actor, { ...narrowing, after: reading.at(-1)?.seq });
      if (next.ok) state.reading = next;
      else controller.error(new Error(`the log refused a reading: ${next.code}`));
    },
  });
}

/** The Activity screen's data routes. */
export const activityRoutes = new Hono<Shared>()
  .get("/activity", vValidator("query", PAGE_QUERY, refuseInvalid), async (context) => {
    const { after, back, size, ...narrowing } = context.req.valid("query");
    // A page follows one place or leads to another, never both.
    if (after !== undefined && back !== undefined) return refused(context, { code: "bad_argument", about: "back" });

    const asker = context.get("asker");
    const turned = narrowing.dir === "asc" ? ("desc" as const) : ("asc" as const);
    // One entry more than a page holds is asked for: it says whether a page lies beyond, and is not shown. A page gone back to is read against the order, from the entry it leads to.
    const reading = back === undefined ? { ...narrowing, after } : { ...narrowing, dir: turned, after: back };
    const read = await listAuditForScreen(asker.install, asker.actor, { ...reading, limit: size + 1 });
    if (!read.ok) return refused(context, read);

    const page = back === undefined ? read.entries.slice(0, size) : read.entries.slice(0, size).reverse();
    const beyond = read.entries.length > size;
    const [now, logins] = await Promise.all([sitesNow(asker.install, page), loginNames(asker)]);
    const entries = page.map(({ site, ...entry }) => ({
      ...entry,
      // The name is the one the site had then; the label and the title are the ones it has now, each `null` once it is no site.
      site: site === null ? null : { name: site.name, label: now.get(site.id)?.label ?? null, title: now.get(site.id)?.title ?? null },
    }));
    const { previous, next } = placesAround({ after, back, along: narrowing.dir === "asc" ? 1 : -1, ends: [page.at(0), page.at(-1)], beyond, stopped: read.stopped_at });

    return context.json({
      ok: true as const,
      entries,
      logins,
      next: next === undefined ? null : String(next),
      previous: previous === undefined ? null : String(previous),
      // A narrowed page that stopped short with the log going on: its place in the direction it was read goes on from where it stopped.
      stopped: read.stopped_at !== undefined,
    });
  })
  .get("/activity/total", vValidator("query", AUDIT_COUNT_QUERY, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const counted = await countAudit(install, actor, context.req.valid("query"));
    if (!counted.ok) return refused(context, counted);

    // A count that read its most is the least the total can be: the log may go on behind what was read.
    return context.json({ ok: true as const, total: counted.count, whole: counted.whole });
  })
  .get("/activity/download", vValidator("query", FILE_QUERY, refuseInvalid), async (context) => {
    const { format, part, after, ...narrowing } = context.req.valid("query");
    const asker = context.get("asker");
    const first = await listAuditForFile(asker.install, asker.actor, { ...narrowing, after });
    if (!first.ok) return refused(context, first);

    const logins = await loginNames(asker);
    const writer = FILE_WRITERS[format];
    const day = new Date(asker.install.now()).toISOString().slice(0, DAY_LENGTH);
    const lineOf = (entry: Entry): string => writer.line(fileEntryOf(entry, logins));
    const body = fileOf(asker, narrowing, first, { head: writer.head, lineOf, cut: writer.cut(CUT_NOTE), stopped: writer.cut(STOPPED_NOTE) });

    const name = part === undefined ? day : `${day}-${part}`;

    return context.body(body, 200, { "Content-Type": writer.type, "Content-Disposition": `attachment; filename="poplin-activity-${name}.${format}"` });
  })
  .get("/activity/download/next", vValidator("query", v.strictObject(FILE_PLACE), refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const next = await nextAuditFile(install, actor, { ...context.req.valid("query"), entries: MOST_IN_FILE });
    if (!next.ok) return refused(context, next);

    return context.json({ ok: true as const, after: next.after === null ? null : String(next.after) });
  });
