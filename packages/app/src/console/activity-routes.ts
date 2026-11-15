// The data of the Activity screen: one page of the audit log, the newest entry first, or the oldest first when asked, and how many entries the log holds.
//
//   GET /activity         one page; ?kind= keeps one kind of action, ?site= the entries about a site whose name then held the text, ?dir=asc the oldest first, ?size= how many entries it holds,
//                         ?after= goes on after a page in that direction, ?back= goes back to the page ahead of one
//   GET /activity/total   how many entries the log holds under ?kind= and ?site=, counted no further back than the newest 10,000

import { vValidator } from "@hono/valibot-validator";
import { AUDIT_COUNT_QUERY, AUDIT_QUERY, countAudit, listAudit } from "@poplin/core/src/actions/audit-log";
import type { Install } from "@poplin/core/src/actions/records";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";
import * as v from "valibot";

import { loginNames, refused, refuseInvalid, type Shared } from "./data";

/** How many entries one page of the log may hold, as the address names them; the first when it names none. */
const PAGE_SIZES = ["50", "100", "200"] as const;

/** The most entries one reading of the log answers. */
const MOST_READ = 100;

/** The place a page ended or began, as the address carries it: the `seq` of an entry. */
const PLACE = v.optional(v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,15}$/), v.transform(Number)));

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
async function entriesFrom({ install, actor }: Shared["Variables"]["asker"], reading: Reading, count: number): Promise<Extract<Listed, { ok: true }> | Extract<Listed, { ok: false }>> {
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
  });
