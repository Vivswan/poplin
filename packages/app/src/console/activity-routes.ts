// The data of the Activity screen: one page of the audit log, the newest entry first, or the oldest first when asked.
//
//   GET /activity   one page; ?kind= keeps one kind of action, ?site= the entries about a site whose name then held the text, ?dir=asc the oldest first, ?after= goes on after a page in that direction

import { vValidator } from "@hono/valibot-validator";
import { AUDIT_QUERY, listAudit } from "@poplin/core/src/actions/audit-log";
import type { Install } from "@poplin/core/src/actions/records";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";
import * as v from "valibot";

import { loginNames, refused, refuseInvalid, type Shared } from "./data";

/** How many entries one page of the log holds. */
const PAGE_SIZE = 50;

/** The place a page ended, as the address carries it: the `seq` of its last entry. */
const SEQ_PATTERN = /^[1-9][0-9]{0,15}$/;

/** What the log's address may ask for, and nothing else: a key it does not know is refused, as the log itself refuses it. */
const PAGE_QUERY = v.strictObject({
  kind: AUDIT_QUERY.entries.kind,
  site: AUDIT_QUERY.entries.site,
  after: v.optional(v.pipe(v.string(), v.regex(SEQ_PATTERN), v.transform(Number))),
  dir: AUDIT_QUERY.entries.dir,
});

/** One entry of the log. */
type Entry = Extract<Awaited<ReturnType<typeof listAudit>>, { ok: true }>["entries"][number];

/** The label each site the entries name has now, by its id, read in one query however many sites a page names. A site that is gone has none. */
async function labelsOf(install: Install, entries: readonly Entry[]): Promise<ReadonlyMap<string, string>> {
  const ids = new Set(entries.flatMap((entry) => (entry.site === null ? [] : [entry.site.id])));
  const names = await install.database.getSiteNames([...ids]);

  return new Map(Array.from(names, ([id, name]) => [id, siteLabel(name, id)]));
}

/** The Activity screen's data route. */
export const activityRoutes = new Hono<Shared>().get("/activity", vValidator("query", PAGE_QUERY, refuseInvalid), async (context) => {
  const { install, actor } = context.get("asker");
  // One entry more than a page holds is asked for: it says whether a page follows, and is not shown.
  const listed = await listAudit(install, actor, { ...context.req.valid("query"), limit: PAGE_SIZE + 1 });
  if (!listed.ok) return refused(context, listed);

  const page = listed.entries.slice(0, PAGE_SIZE);
  const [labels, logins] = await Promise.all([labelsOf(install, page), loginNames(context.get("asker"))]);
  const entries = page.map(({ site, ...entry }) => ({
    ...entry,
    // The name is the one the site had then; the label is the one it has now, and `null` once it is no site.
    site: site === null ? null : { name: site.name, label: labels.get(site.id) ?? null },
  }));
  const last = page.at(-1);

  return context.json({ ok: true as const, entries, logins, next: listed.entries.length <= PAGE_SIZE || last === undefined ? null : String(last.seq) });
});
