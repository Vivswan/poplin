// The API rule of the install's zone, read at Cloudflare with the key a live run holds: what a check compares with the rule poplin writes, so a rule the zone refused shows as that rule's failed row and nothing else.

import { type Connection, findZones } from "../src/shared/install/client";
import { INSTALL_OBJECTS } from "../src/shared/install/install-objects";
import { parseDomainLayout } from "../src/with-domain/layout";
import { apiRule } from "../src/with-domain/pieces/rules/guards";
import { readPhase, type RuleBody } from "../src/with-domain/pieces/rules/rules";

/** The phase the guard rules are in. */
const CUSTOM_PHASE = "http_request_firewall_custom";

/** The API rule as the zone answers it: each field the rule poplin writes has, as Cloudflare holds it. */
type HeldRule = Readonly<Partial<Record<keyof RuleBody, unknown>>>;

/** The API rule as poplin wants it in the zone, and as the zone holds it: `undefined` where the zone holds no rule of its ref. */
export interface ApiRuleReading {
  readonly wanted: RuleBody;
  readonly held: HeldRule | undefined;
}

/**
 * Read the API rule of the install's zone beside the rule poplin wants there.
 *
 * @param domain - the install's domain, which names its zone and shapes the rule
 * @returns the rule as the zone holds it, in the fields of the wanted rule alone, so a field poplin writes is never left out of the comparison and no other is in it
 * @throws {Error} Cloudflare refused the listing or the reading, or the account holds no active zone of the domain; the message is one of this file's own, and holds nothing Cloudflare or the connection said
 */
export async function readApiRule(connection: Connection, accountId: string, domain: string): Promise<ApiRuleReading> {
  const layout = parseDomainLayout({ domain });
  if (!layout.ok) throw new Error("the run's domain is no layout an install takes");

  // A reading that ends in an exception is told in this file's words too: what was thrown may quote the request.
  const zones = await findZones(connection, domain).catch(() => undefined);
  if (zones === undefined) throw new Error("the zones at Cloudflare could not be listed: the listing failed");

  if (!zones.ok) throw new Error(`the zones at Cloudflare could not be listed: ${zones.failure}`);

  const zone = zones.value.find((candidate) => candidate.accountId === accountId);
  if (zone === undefined) throw new Error("the account holds no zone of the install's domain");

  const phase = await readPhase(connection, zone.id, CUSTOM_PHASE).catch(() => undefined);
  if (phase === undefined) throw new Error("the zone's custom rules at Cloudflare could not be read: the reading failed");

  if (!phase.ok) throw new Error(`the zone's custom rules at Cloudflare could not be read: ${phase.failure}`);

  const wanted = apiRule(layout.value);
  const held = phase.value?.rules.find((rule) => rule.ref === INSTALL_OBJECTS.apiRef);

  return { wanted, held: held === undefined ? undefined : Object.fromEntries(Object.entries(held).filter(([field]) => field in wanted)) };
}
