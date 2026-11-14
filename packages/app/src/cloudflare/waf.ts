// The zone's rate rule. It carries a fixed `ref`, the name the Rulesets API keeps on a rule, and poplin changes no rule without it.

import type { Connection, ZonePlan } from "./client";
import { type DomainLayout, siteEnding } from "./layout";
import { type PhaseRules, planOwnRule, quoted, type RuleStep, removeOwnRule, syncPhase } from "./rules";
import type { Synced } from "./sync";

const RATE_REF = "poplin_rate";
const RATE_SUBJECT = "rate rule";
const RATE_PHASE = "http_ratelimit";
const RATE_LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const RATE_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 1, pro: 2, business: 5, enterprise: 100 };
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "the Free plan's rate rule would also limit this zone's other hostnames";

/** The rule an install wants. `sharesZone` says whether the zone has hostnames of its own. */
interface DesiredRules {
  readonly layout: DomainLayout;
  readonly plan: ZonePlan;
  readonly sharesZone: boolean;
}

/**
 * Write the expression of the rate rule: true for the requests the routes send to the Worker.
 *
 * @returns on the Free plan, whose rate rules may read the path alone, an expression true for every request of the zone; the plan uses it only for a zone with no hostname of its own
 * @throws {Error} a hostname or suffix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function rateRuleExpression(layout: DomainLayout, plan: ZonePlan): string {
  if (plan === "free") return 'http.request.uri.path contains "/"';

  return `ends_with(http.host, ${quoted(siteEnding(layout))}) or http.host eq ${quoted(layout.adminHostname)}`;
}

/**
 * Compute the rule change an install needs.
 *
 * @param current - the entry point ruleset of the rate limiting phase as it is now
 * @returns the rate rule's step; a rule poplin cannot have is skipped with its reason, after the removal of one an earlier run made
 */
export function planWaf(desired: DesiredRules, current: PhaseRules | undefined): RuleStep[] {
  // The whole-zone rule an earlier run made would go on limiting the hostnames the zone has since gained.
  if (desired.plan === "free" && desired.sharesZone)
    return [...removeOwnRule(RATE_SUBJECT, RATE_REF, current), { kind: "skip", subject: RATE_SUBJECT, reason: LIMITS_OTHERS }];

  const others = current?.rules.filter((rule) => rule.ref !== RATE_REF).length ?? 0;
  const rule = {
    ref: RATE_REF,
    description: "poplin: limit requests per address",
    expression: rateRuleExpression(desired.layout, desired.plan),
    action: "block",
    enabled: true,
    ratelimit: RATE_LIMIT,
  } as const;

  return [planOwnRule({ subject: RATE_SUBJECT, rule, hasRoom: others < RATE_RULE_SLOTS[desired.plan], full: SLOT_TAKEN }, current)];
}

/**
 * Make the zone's rate rule match an install.
 *
 * @returns what was created, changed, left, or removed; a rate rule poplin cannot have, or would have to widen to the zone's other hostnames, is a skip with its reason, never a failure
 */
export function syncWaf(connection: Connection, zoneId: string, desired: DesiredRules): Promise<Synced> {
  return syncPhase(connection, zoneId, RATE_PHASE, (current) => planWaf(desired, current));
}
