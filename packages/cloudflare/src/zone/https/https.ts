// The redirect that sends a request over `http` to `https` before the Worker runs. It reads poplin's own hostnames alone, so the zone's other hostnames stay as they are.
//
//   the zone's Always Use HTTPS is on, and poplin has no rule   nothing is written: the zone already redirects every hostname
//   otherwise                                                   one redirect rule with poplin's `ref`, made or kept as written
//
// The zone-wide switch is only ever read: it covers hostnames that are not poplin's.

import { BaseSettings } from "cloudflare/resources/zones/settings";
import { type Connection, callCloudflare, type ZonePlan } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { type DomainLayout, siteEndings } from "../layout";
import { type PhaseRules, planOwnRule, quoted, type RuleStep, siteTerms, syncPhase } from "../rules/rules";
import { type Mode, reportOf, type Synced } from "../sync";

const REDIRECT_PHASE = "http_request_dynamic_redirect";
const REDIRECT_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 10, pro: 25, business: 50, enterprise: 300 };
const HTTPS_REF = INSTALL_OBJECTS.httpsRef;
const SUBJECT = "https redirect";
const ZONE_SWITCH = "always_use_https";
const SLOTS_FULL = "the zone's plan allows no further redirect rule and other rules hold every slot";

/** The redirect an install wants. */
interface DesiredHttps {
  /** The hostnames the rule reads. */
  readonly layout: DomainLayout;

  /** The zone's plan, which sets how many redirect rules the zone may hold. */
  readonly plan: ZonePlan;
}

/** What the zone has now. */
interface CurrentHttps {
  /** Whether the zone's own Always Use HTTPS is on. */
  readonly zoneRedirects: boolean;

  /** The entry point ruleset of the redirect phase; a zone that never had a redirect rule has none. */
  readonly rules: PhaseRules | undefined;
}

/**
 * Write the expression of the redirect rule: true for a request over `http` to a site hostname or the admin hostname.
 *
 * @returns an expression false for every other hostname of the zone
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function plainHttpExpression(layout: DomainLayout): string {
  const hosts = [...siteTerms(siteEndings(layout)), `http.host eq ${quoted(layout.adminHostname)}`];

  return `${INSTALL_OBJECTS.plainHttp} and (${hosts.join(" or ")})`;
}

/**
 * Compute the change the redirect needs.
 *
 * @returns one step: a `leave` when the zone redirects by itself and poplin has no rule, else the step that makes poplin's rule match; a rule the plan has no slot for is skipped with its reason
 */
export function planHttps(desired: DesiredHttps, current: CurrentHttps): RuleStep[] {
  const rules = current.rules?.rules ?? [];
  const own = rules.some((rule) => rule.ref === HTTPS_REF);
  if (current.zoneRedirects && !own) return [{ kind: "leave", subject: SUBJECT }];

  const rule = {
    ref: HTTPS_REF,
    description: INSTALL_OBJECTS.httpsDescription,
    expression: plainHttpExpression(desired.layout),
    action: "redirect",
    enabled: true,
    action_parameters: { from_value: { target_url: { expression: INSTALL_OBJECTS.httpsTarget }, status_code: INSTALL_OBJECTS.httpsStatus, preserve_query_string: true } },
  } as const;

  return [planOwnRule({ subject: SUBJECT, rule, hasRoom: rules.length < REDIRECT_RULE_SLOTS[desired.plan], full: SLOTS_FULL }, current.rules)];
}

/**
 * Make sure a request over `http` to one of poplin's hostnames is redirected before the Worker.
 *
 * @param mode - `plan` reads the switch and the redirect phase and sends no change
 * @returns what was created, changed, or left; a switch that cannot be read stops the run before anything is written, since the answer decides whether a rule is made
 */
export async function syncHttps(connection: Connection, zoneId: string, desired: DesiredHttps, mode: Mode): Promise<Synced> {
  const zoneSwitch = await callCloudflare(connection, (api) => new BaseSettings(api).get(ZONE_SWITCH, { zone_id: zoneId }));
  if (!zoneSwitch.ok) return { ...zoneSwitch, report: reportOf([]) };

  const zoneRedirects = (zoneSwitch.value as { readonly value?: unknown }).value === "on";

  return syncPhase(connection, zoneId, REDIRECT_PHASE, (rules) => planHttps(desired, { zoneRedirects, rules }), mode);
}
