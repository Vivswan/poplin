// The data of the Activity screen: one page of the audit log, the newest entry first, or the oldest first when asked, and how many entries the log holds.
//
//   GET /activity         one page; ?kind= keeps one kind of action, ?site= the entries about a site whose name then held the text, ?dir=asc the oldest first, ?size= how many entries it holds,
//                         ?after= goes on after a page in that direction, ?back= goes back to the page ahead of one
//   GET /activity/total   how many entries the log holds under ?kind= and ?site=, counted no further back than the newest 10,000
//   GET /activity/download        the entries under ?kind= and ?site= as a file, the newest first and 2,000 at the most, in ?format=csv or jsonl; ?after= goes on after the file before, and ?part= numbers the file's name
//   GET /activity/download/next   the place the file after one goes on from, or none when the log ends with it

import { vValidator } from "@hono/valibot-validator";
import { AUDIT_COUNT_QUERY, AUDIT_FILE_PAGE, AUDIT_QUERY, countAudit, listAudit, listAuditForFile, nextAuditFile } from "@poplin/core/src/actions/audit-log";
import type { Install } from "@poplin/core/src/actions/records";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";
import * as v from "valibot";

import { FILE_WRITERS, type FileEntry, MOST_IN_FILE } from "./activity-file";
import { whatOf } from "./activity-what";
import { loginNames, refused, refuseInvalid, type Shared } from "./data";

/** How many entries one page of the log may hold, as the address names them; the first when it names none. */
const PAGE_SIZES = ["50", "100", "200"] as const;

/** The most entries one reading of the log answers. */
const MOST_READ = 100;

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** What a file that holds fewer entries than the log says in its last line. */
const CUT_NOTE = `${MOST_IN_FILE.toLocaleString("en-US")} entries. The log holds more: download the next part.`;

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

/** Which entries of the log are read, in which direction, and after which place. */
type Reading = Pick<v.InferOutput<typeof PAGE_QUERY>, "kind" | "site" | "dir"> & { readonly after?: number | undefined };

/** Who asks, and of which install. */
type Asker = Shared["Variables"]["asker"];

/** Which entries of the log a file is narrowed to. */
type Narrowing = Pick<v.InferOutput<typeof FILE_QUERY>, "kind" | "site">;

/** The label each site the entries name has now, by its id, read in one query however many sites a page names. A site that is gone has none. */
async function labelsOf(install: Install, entries: readonly Entry[]): Promise<ReadonlyMap<string, string>> {
  const ids = new Set(entries.flatMap((entry) => (entry.site === null ? [] : [entry.site.id])));
  const names = await install.database.getSiteNames([...ids]);

  return new Map(Array.from(names, ([id, name]) => [id, siteLabel(name, id)]));
}

/**
 * Read the entries that follow a place of the log, in as many readings of the log as they take.
 *
 * @param count - how many entries at the most
 * @returns the entries, or the log's own refusal
 */
async function entriesFrom({ install, actor }: Asker, reading: Reading, count: number): Promise<Extract<Listed, { ok: true }> | Extract<Listed, { ok: false }>> {
  const entries: Entry[] = [];
  let after = reading.after;

  while (entries.length < count) {
    const limit = Math.min(MOST_READ, count - entries.length);
    const listed = await listAudit(install, actor, { ...reading, after, limit });
    if (!listed.ok) return listed;

    entries.push(...listed.entries);
    after = listed.entries.at(-1)?.seq;
    if (listed.entries.length < limit) break;
  }

  return { ok: true, entries };
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

/** Whether the log holds an entry behind the last one a full file holds. */
async function goesOn({ install, actor }: Asker, narrowing: Narrowing, after: number): Promise<boolean> {
  const beyond = await listAudit(install, actor, { ...narrowing, after, limit: 1 });

  return beyond.ok && beyond.entries.length > 0;
}

/**
 * Stream a file of the log: each reading of the log is written and handed on before the next is made, so no more than one reading is held at a time.
 *
 * @param first - the first reading, made before the answer began so that its refusal could still be answered
 * @param writer - writes the file's start, each entry as a line, and the last line of a file that holds fewer entries than the log
 * It is the platform's own stream, not the framework's streaming helper: that one closes a failed answer as if it were whole, and a cut file must not look complete.
 *
 * @returns the file's bytes; a reading that fails after the first ends the stream with an error, which a browser reports as a failed download
 */
function fileOf(asker: Asker, narrowing: Narrowing, first: readonly Entry[], writer: { readonly head: string; readonly lineOf: (entry: Entry) => string; readonly cut: string }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const state = { reading: first, written: 0 };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (writer.head !== "") controller.enqueue(encoder.encode(writer.head));
    },
    async pull(controller) {
      const { reading } = state;
      const last = reading.at(-1);
      if (reading.length > 0) controller.enqueue(encoder.encode(reading.map(writer.lineOf).join("")));

      state.written += reading.length;
      // A short reading is the log's end.
      if (last === undefined || reading.length < AUDIT_FILE_PAGE) {
        controller.close();
      } else if (state.written >= MOST_IN_FILE) {
        if (await goesOn(asker, narrowing, last.seq)) controller.enqueue(encoder.encode(writer.cut));

        controller.close();
      } else {
        const next = await listAuditForFile(asker.install, asker.actor, { ...narrowing, after: last.seq });
        if (next.ok) state.reading = next.entries;
        else controller.error(new Error(`the log refused a reading: ${next.code}`));
      }
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
    const turned = narrowing.dir === "asc" ? "desc" : "asc";
    // One entry more than a page holds is asked for: it says whether a page lies beyond, and is not shown. A page gone back to is read against the order, from the entry it leads to.
    const read = await entriesFrom(asker, back === undefined ? { ...narrowing, after } : { ...narrowing, dir: turned, after: back }, size + 1);
    if (!read.ok) return refused(context, read);

    const page = back === undefined ? read.entries.slice(0, size) : read.entries.slice(0, size).reverse();
    const beyond = read.entries.length > size;
    const [labels, logins] = await Promise.all([labelsOf(asker.install, page), loginNames(asker)]);
    const entries = page.map(({ site, ...entry }) => ({
      ...entry,
      // The name is the one the site had then; the label is the one it has now, and `null` once it is no site.
      site: site === null ? null : { name: site.name, label: labels.get(site.id) ?? null },
    }));
    const [first, last] = [page.at(0), page.at(-1)];
    // A page gone back to came from the page after it; a page gone on to came from the page ahead of it.
    const follows = back === undefined ? beyond : true;
    const leads = back === undefined ? after !== undefined : beyond;

    return context.json({
      ok: true as const,
      entries,
      logins,
      next: follows && last !== undefined ? String(last.seq) : null,
      previous: leads && first !== undefined ? String(first.seq) : null,
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
    const body = fileOf(asker, narrowing, first.entries, { head: writer.head, lineOf: (entry) => writer.line(fileEntryOf(entry, logins)), cut: writer.cut(CUT_NOTE) });

    const name = part === undefined ? day : `${day}-${part}`;

    return context.body(body, 200, { "Content-Type": writer.type, "Content-Disposition": `attachment; filename="poplin-activity-${name}.${format}"` });
  })
  .get("/activity/download/next", vValidator("query", v.strictObject(FILE_PLACE), refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const next = await nextAuditFile(install, actor, { ...context.req.valid("query"), entries: MOST_IN_FILE });
    if (!next.ok) return refused(context, next);

    return context.json({ ok: true as const, after: next.after === null ? null : String(next.after) });
  });
