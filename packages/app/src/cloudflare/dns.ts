// The zone's DNS records for a layout. Poplin's own records carry a fixed comment, the one mark the API keeps on every plan, and no other record is ever changed.

import { BaseRecords } from "cloudflare/resources/dns/records";
import { type Connection, callCloudflare } from "./client";
import { type Hostname, parseHostname } from "./hostname";
import { type DomainLayout, ownHostnames, siteParent } from "./layout";
import { applySteps, type Report, reportOf, type SyncFailure } from "./sync";

// The mark on every record poplin creates.
const POPLIN_COMMENT = "managed by poplin";

// A Worker route answers only on a hostname with a proxied record; this address is the discard prefix, never reached.
const PLACEHOLDER = { type: "AAAA", content: "100::", proxied: true, ttl: 1, comment: POPLIN_COMMENT } as const;

// The record types that answer for a hostname.
const ADDRESS_TYPES: ReadonlySet<string> = new Set(["A", "AAAA", "CNAME"]);

// The record types that already hold a name: Cloudflare lets no new address record sit beside one.
const HOLDING_TYPES: ReadonlySet<string> = new Set([...ADDRESS_TYPES, "NS"]);

// Why a desired name is skipped.
const OCCUPIED = "a record poplin did not create holds this name";

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

/** A finished run with the zone's other hostnames, or the failure that stopped it. */
type DnsSynced =
  | { readonly ok: true; readonly report: Report; readonly otherHostnames: readonly Hostname[] }
  | { readonly ok: false; readonly failure: "foreign-wildcards"; readonly wildcards: readonly string[]; readonly message: string; readonly report: Report }
  | SyncFailure;

function desiredNames(layout: DomainLayout): string[] {
  return [`*.${siteParent(layout)}`, ...ownHostnames(layout)];
}

function isPlaceholder(record: ZoneRecord): boolean {
  return record.type === PLACEHOLDER.type && record.content === PLACEHOLDER.content && record.proxied === PLACEHOLDER.proxied;
}

// Of several marked records under one name the correct one is kept, so no change collides with it.
function ownRecord(name: string, records: readonly ZoneRecord[]): ZoneRecord | undefined {
  const mine = records.filter((record) => record.name === name && record.comment === POPLIN_COMMENT);

  return mine.find(isPlaceholder) ?? mine[0];
}

function planName(name: string, records: readonly ZoneRecord[]): DnsStep {
  const own = ownRecord(name, records);

  if (own !== undefined && isPlaceholder(own)) return { kind: "leave", subject: name };

  if (own !== undefined) return { kind: "change", subject: name, id: own.id };

  if (records.some((record) => record.name === name && HOLDING_TYPES.has(record.type))) return { kind: "skip", subject: name, reason: OCCUPIED };

  return { kind: "create", subject: name };
}

function wildcardMessage(wildcards: readonly string[]): string {
  const names = wildcards.join(", ");

  return `The zone has wildcard records poplin did not create: ${names}. Poplin's routes and rules would take over or block every name they answer for. Replace each with records for exact names, or remove it, then run this again.`;
}

/**
 * Read the zone's wildcard records that poplin did not create: every name one answers for is on no list, so a route or rule of poplin's would catch it.
 *
 * @returns each name once, sorted, the one the layout's own wildcard would share included
 */
export function foreignWildcards(records: readonly ZoneRecord[]): string[] {
  const foreign = records.filter((record) => record.comment !== POPLIN_COMMENT && ADDRESS_TYPES.has(record.type));
  const wildcards = foreign.map((record) => record.name).filter((name) => name.includes("*"));

  return [...new Set(wildcards)].sort();
}

/**
 * Read the zone's other exact hostnames: the ones the WAF host rule must let through and the Worker routes must step around.
 *
 * @returns each once, sorted; never a wildcard, a name poplin's layout uses, or a record poplin created
 */
export function otherHostnames(layout: DomainLayout, records: readonly ZoneRecord[]): Hostname[] {
  const desired = new Set(desiredNames(layout));
  const others = new Set<Hostname>();

  for (const record of records) {
    if (record.comment === POPLIN_COMMENT || !ADDRESS_TYPES.has(record.type) || desired.has(record.name)) continue;

    const hostname = parseHostname(record.name);
    if (hostname.ok) others.add(hostname.value);
  }

  return [...others].sort();
}

/**
 * Compute the record changes a layout needs.
 *
 * @param records - every record of the zone as it is now
 * @returns a removal for each record poplin created that the layout no longer uses, first so no later change collides with one, then one step per desired name
 */
export function planDns(layout: DomainLayout, records: readonly ZoneRecord[]): DnsStep[] {
  const names = desiredNames(layout);
  const mine = records.filter((record) => record.comment === POPLIN_COMMENT);
  const kept = names.map((name) => ownRecord(name, records));
  const stale = mine.filter((record) => !kept.includes(record));

  return [...stale.map((record): DnsStep => ({ kind: "remove", subject: record.name, id: record.id })), ...names.map((name) => planName(name, records))];
}

/**
 * Make the zone's records match a layout.
 *
 * @returns what was created, changed, left, and removed, with the zone's other hostnames as read before the changes; a zone with a wildcard record of its own is refused before any change, so no route or rule can follow
 */
export async function syncDns(connection: Connection, zoneId: string, layout: DomainLayout): Promise<DnsSynced> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseRecords(api).list({ zone_id: zoneId })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const records = listed.value.map(({ id, name, type, content, proxied, comment }) => ({ id, name, type, content, proxied, comment }));
  const wildcards = foreignWildcards(records);
  if (wildcards.length > 0) return { ok: false, failure: "foreign-wildcards", wildcards, message: wildcardMessage(wildcards), report: reportOf([]) };

  const body = { zone_id: zoneId, ...PLACEHOLDER };

  const synced = await applySteps(planDns(layout, records), (step) => {
    if (step.kind === "create") return callCloudflare(connection, (api) => new BaseRecords(api).create({ ...body, name: step.subject }));

    if (step.kind === "change") return callCloudflare(connection, (api) => new BaseRecords(api).update(step.id, { ...body, name: step.subject }));

    return callCloudflare(connection, (api) => new BaseRecords(api).delete(step.id, { zone_id: zoneId }));
  });
  if (!synced.ok) return synced;

  return { ...synced, otherHostnames: otherHostnames(layout, records) };
}
