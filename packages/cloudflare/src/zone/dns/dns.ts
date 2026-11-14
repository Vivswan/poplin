// The zone's DNS records for a layout. Poplin's own records carry a comment that starts with a fixed mark, the one mark the API keeps on every plan, and no other record is ever changed.

import { BaseRecords } from "cloudflare/resources/dns/records";
import { type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { type DomainLayout, siteEnding } from "../layout";
import { applySteps, type Mode, type Report, reportOf, type SyncFailure } from "../sync";

// A Worker route answers only on a hostname with a proxied record; this address is the discard prefix, never reached.
const PLACEHOLDER = { type: INSTALL_OBJECTS.recordType, content: INSTALL_OBJECTS.recordContent, proxied: true, ttl: 1 } as const;

// The record types that answer for a hostname.
const ADDRESS_TYPES: ReadonlySet<string> = new Set(["A", "AAAA", "CNAME"]);

// The record types that already hold a name: Cloudflare lets no new address record sit beside one.
const HOLDING_TYPES: ReadonlySet<string> = new Set([...ADDRESS_TYPES, "NS"]);

// Why a desired name is skipped: another kind of record holds it.
const OCCUPIED = "a record poplin did not create holds this name";

// Why the wildcard is skipped: a second record beside the zone's would answer for the zone's other names in turn with it.
const ZONE_WILDCARD = "the zone's own proxied wildcard record already carries the site hostnames to Cloudflare";

/** A record as the zone has it now. */
interface ZoneRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string | undefined;
  readonly proxied: boolean | undefined;
  readonly comment: string | undefined;
}

/** One step of a DNS plan; `subject` is the record's name. */
type DnsStep =
  | { readonly kind: "create"; readonly subject: string }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "change"; readonly subject: string; readonly id: string }
  | { readonly kind: "remove"; readonly subject: string; readonly id: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

/** Records of the zone's own that poplin cannot work beside. `names` are theirs, each once, sorted; `message` says the ways out. */
interface RecordsRefusal {
  readonly failure: "shadowed-records" | "unproxied-wildcard";
  readonly names: readonly string[];
  readonly message: string;
}

/** A finished run, or the failure that stopped it. `sharesZone` says whether the zone has hostnames of its own, as read before the changes. */
type DnsSynced =
  | { readonly ok: true; readonly report: Report; readonly sharesZone: boolean }
  | ({ readonly ok: false; readonly report: Report } & RecordsRefusal)
  | SyncFailure;

// DNS has no partial wildcard: the record the site hostnames resolve through covers every name under the domain with no record of its own.
function wildcardName(layout: DomainLayout): string {
  return `*.${layout.domain}`;
}

// The setup client and the OpenTofu module both start the comment of a record they create with the mark.
function isOwn(record: ZoneRecord): boolean {
  return record.comment?.startsWith(INSTALL_OBJECTS.recordMark) === true;
}

// The comment says what the name is for, so the wildcard's differs from the admin hostname's.
function commentOf(layout: DomainLayout, name: string): string {
  return name === wildcardName(layout) ? INSTALL_OBJECTS.wildcardComment : INSTALL_OBJECTS.adminComment;
}

// The zone's own records that answer for a hostname.
function zoneAddresses(records: readonly ZoneRecord[]): ZoneRecord[] {
  return records.filter((record) => !isOwn(record) && ADDRESS_TYPES.has(record.type));
}

function namesOf(records: readonly ZoneRecord[]): string[] {
  return [...new Set(records.map((record) => record.name))].sort();
}

function isPlaceholder(layout: DomainLayout, record: ZoneRecord): boolean {
  const answers = record.type === PLACEHOLDER.type && record.content === PLACEHOLDER.content && record.proxied === PLACEHOLDER.proxied;

  return answers && record.comment === commentOf(layout, record.name);
}

// Of several marked records under one name the correct one is kept, so no change collides with it.
function ownRecord(layout: DomainLayout, name: string, records: readonly ZoneRecord[]): ZoneRecord | undefined {
  const mine = records.filter((record) => record.name === name && isOwn(record));

  return mine.find((record) => isPlaceholder(layout, record)) ?? mine[0];
}

function planName(layout: DomainLayout, name: string, records: readonly ZoneRecord[]): DnsStep {
  const own = ownRecord(layout, name, records);

  if (own !== undefined && isPlaceholder(layout, own)) return { kind: "leave", subject: name };

  if (own !== undefined) return { kind: "change", subject: name, id: own.id };

  if (records.some((record) => record.name === name && HOLDING_TYPES.has(record.type))) return { kind: "skip", subject: name, reason: OCCUPIED };

  return { kind: "create", subject: name };
}

/**
 * Find the zone's own records poplin cannot work beside: one under a name a route would take from its owner, or a wildcard that is not proxied.
 *
 * @param records - every record of the zone as it is now
 * @returns the refusal, or `undefined` for a zone poplin can be set up in
 */
export function refusedRecords(layout: DomainLayout, records: readonly ZoneRecord[]): RecordsRefusal | undefined {
  const theirs = zoneAddresses(records);
  const shadowed = namesOf(theirs.filter((record) => record.name === layout.adminHostname || record.name.endsWith(siteEnding(layout))));

  if (shadowed.length > 0) {
    const message = `The zone has records of its own under names poplin's routes would take: ${shadowed.join(", ")}. Choose another suffix or admin hostname, or rename them, then run this again.`;

    return { failure: "shadowed-records", names: shadowed, message };
  }

  const wildcard = wildcardName(layout);
  const unproxied = theirs.some((record) => record.name === wildcard && record.proxied !== true);
  if (!unproxied) return undefined;

  const message = `The zone's own record ${wildcard} is not proxied, so every site hostname would resolve to its origin and never reach poplin. Switch its proxy on, or remove it, then run this again.`;

  return { failure: "unproxied-wildcard", names: [wildcard], message };
}

/**
 * Decide whether the zone has hostnames of its own: a rate rule that reads the path alone would count their requests too.
 *
 * @returns `true` for any record of the zone's own that answers for a hostname, a wildcard included
 */
export function sharesZone(records: readonly ZoneRecord[]): boolean {
  return zoneAddresses(records).length > 0;
}

/**
 * Compute the record changes a layout needs.
 *
 * @param records - every record of a zone `refusedRecords` passed, as it is now
 * @returns a removal for each record poplin created that the layout no longer uses, first so no later change collides with one, then one step per desired name
 */
export function planDns(layout: DomainLayout, records: readonly ZoneRecord[]): DnsStep[] {
  const wildcard = wildcardName(layout);
  const carried = zoneAddresses(records).some((record) => record.name === wildcard);
  const names = carried ? [layout.adminHostname] : [wildcard, layout.adminHostname];

  const mine = records.filter(isOwn);
  const kept = names.map((name) => ownRecord(layout, name, records));
  const stale = mine.filter((record) => !kept.includes(record));

  return [
    ...stale.map((record): DnsStep => ({ kind: "remove", subject: record.name, id: record.id })),
    ...(carried ? [{ kind: "skip", subject: wildcard, reason: ZONE_WILDCARD } as const] : []),
    ...names.map((name) => planName(layout, name, records)),
  ];
}

/**
 * Make the zone's records match a layout.
 *
 * @param mode - `plan` reads the records and sends no change
 * @returns what was created, changed, left, and removed; a zone with a record `refusedRecords` names is refused before any change, so no route can follow
 */
export async function syncDns(connection: Connection, zoneId: string, layout: DomainLayout, mode: Mode): Promise<DnsSynced> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseRecords(api).list({ zone_id: zoneId })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const records = listed.value.map(({ id, name, type, content, proxied, comment }) => ({ id, name, type, content, proxied, comment }));
  const refused = refusedRecords(layout, records);
  if (refused !== undefined) return { ok: false, ...refused, report: reportOf([]) };

  const body = (name: string) => ({ zone_id: zoneId, ...PLACEHOLDER, name, comment: commentOf(layout, name) });

  const synced = await applySteps(planDns(layout, records), (step) => {
    if (step.kind === "create") return callCloudflare(connection, (api) => new BaseRecords(api).create(body(step.subject)));

    if (step.kind === "change") return callCloudflare(connection, (api) => new BaseRecords(api).update(step.id, body(step.subject)));

    return callCloudflare(connection, (api) => new BaseRecords(api).delete(step.id, { zone_id: zoneId }));
  }, mode);
  if (!synced.ok) return synced;

  return { ...synced, sharesZone: sharesZone(records) };
}
