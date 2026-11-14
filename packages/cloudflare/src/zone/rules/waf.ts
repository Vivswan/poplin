// The zone's rate rule. It carries a fixed `ref`, the name the Rulesets API keeps on a rule, and poplin changes no rule without it.

import type { Connection, ZonePlan } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { type DomainLayout, siteEndings } from "../layout";
import { type PhaseRules, planOwnRule, quoted, type RuleStep, removeOwnRule, siteTerms, syncPhase } from "./rules";
import type { Mode, Synced } from "../sync";

const RATE_REF = INSTALL_OBJECTS.rateRef;
const RATE_SUBJECT = "rate rule";
const RATE_PHASE = "http_ratelimit";
const RATE_LIMIT = {
  characteristics: [...INSTALL_OBJECTS.rateCounts],
  period: INSTALL_OBJECTS.ratePeriod,
  requests_per_period: INSTALL_OBJECTS.rateRequests,
  mitigation_timeout: INSTALL_OBJECTS.rateBlockSeconds,
};
const RATE_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 1, pro: 2, business: 5, enterprise: 100 };
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "a rate rule that counts the whole zone would also limit this zone's other hostnames";
const NEEDS_PAID_PLAN = "a rate rule of the Free plan may read the path alone, never the hostname";
const SWITCHED_OFF = "the rate rule is set to off";

/** What the rate rule counts, the values of the OpenTofu module's `rate_rule` input: every request of the zone, the install's hostnames alone, or nothing. */
type RateRule = "zone" | "hostnames" | "off";

/** The rule an install wants. */
interface DesiredRules {
  /** The hostnames the `hostnames` rule reads. */
  readonly layout: DomainLayout;

  /** The zone's plan: it sets how many rate rules the zone may hold, and whether one may read the hostname. */
  readonly plan: ZonePlan;

  /** Whether the zone has hostnames of its own, which a `zone` rule would count too. */
  readonly sharesZone: boolean;

  /** What the rule counts; the plan never picks it. */
  readonly rateRule: RateRule;
}

function skipped(reason: string): RuleStep {
  return { kind: "skip", subject: RATE_SUBJECT, reason };
}

// A whole-zone rule an earlier run made goes on limiting the hostnames the zone has since gained; a rule that reads the hostnames harms none and stays.
function removeWholeZoneRule(current: PhaseRules | undefined): RuleStep[] {
  const own = current?.rules.find((rule) => rule.ref === RATE_REF);
  if (own?.expression !== INSTALL_OBJECTS.rateWholeZone) return [];

  return removeOwnRule(RATE_SUBJECT, RATE_REF, current);
}

/**
 * Name the rate rule to offer a caller that has not chosen one.
 *
 * @returns `zone` on the Free plan, whose rate rules may read the path alone, and `hostnames` on a paid plan
 */
export function defaultRateRule(plan: ZonePlan): "zone" | "hostnames" {
  return plan === "free" ? "zone" : "hostnames";
}

/**
 * Write the expression of the rate rule.
 *
 * @returns for `zone` an expression true for every request of the zone; for `hostnames` one true for the requests the routes send to the Worker and no other
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function rateRuleExpression(layout: DomainLayout, rateRule: "zone" | "hostnames"): string {
  if (rateRule === "zone") return INSTALL_OBJECTS.rateWholeZone;

  return [...siteTerms(siteEndings(layout)), `http.host eq ${quoted(layout.adminHostname)}`].join(" or ");
}

/**
 * Compute the rule change an install needs.
 *
 * @param current - the entry point ruleset of the rate limiting phase as it is now
 * @returns the rate rule's step; a rule the zone cannot hold is skipped with its reason and poplin's rule stays, unless it counts the whole of a zone with hostnames of its own; `off` removes poplin's rule
 */
export function planWaf(desired: DesiredRules, current: PhaseRules | undefined): RuleStep[] {
  const { rateRule } = desired;

  if (rateRule === "off") return [...removeOwnRule(RATE_SUBJECT, RATE_REF, current), skipped(SWITCHED_OFF)];

  if (rateRule === "hostnames" && desired.plan === "free") return [skipped(NEEDS_PAID_PLAN)];

  if (rateRule === "zone" && desired.sharesZone) return [...removeWholeZoneRule(current), skipped(LIMITS_OTHERS)];

  const others = current?.rules.filter((rule) => rule.ref !== RATE_REF).length ?? 0;
  const rule = {
    ref: RATE_REF,
    description: INSTALL_OBJECTS.rateDescription,
    expression: rateRuleExpression(desired.layout, rateRule),
    action: "block",
    enabled: true,
    ratelimit: RATE_LIMIT,
  } as const;

  return [planOwnRule({ subject: RATE_SUBJECT, rule, hasRoom: others < RATE_RULE_SLOTS[desired.plan], full: SLOT_TAKEN }, current)];
}

/**
 * Make the zone's rate rule match an install.
 *
 * @param mode - `plan` reads the rate limiting phase and sends no change
 * @returns what was created, changed, left, or removed; a rate rule the zone cannot hold, or one switched off, is a skip with its reason, never a failure
 */
export function syncWaf(connection: Connection, zoneId: string, desired: DesiredRules, mode: Mode): Promise<Synced> {
  return syncPhase(connection, zoneId, RATE_PHASE, (current) => planWaf(desired, current), mode);
}
