// The two custom rules that stop a request before the Worker runs, so it costs the install nothing. Both read the site hostnames alone.
// A browser calls every hostname under one domain the same site, so the outside pages rule stops pages of other domains and the Worker refuses the rest.

import type { Connection, ZonePlan } from "./client";
import { INSTALL_OBJECTS } from "./install-objects";
import { type DomainLayout, siteEnding } from "./layout";
import { type PhaseRules, planOwnRule, quoted, type RuleStep, removeOwnRule, syncPhase } from "./rules";
import type { Synced } from "./sync";

const CUSTOM_PHASE = "http_request_firewall_custom";
const CUSTOM_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 5, pro: 20, business: 100, enterprise: 1000 };
const OUTSIDE_REF = INSTALL_OBJECTS.outsideRef;
const OUTSIDE_SUBJECT = "outside pages rule";
const BOTS_REF = INSTALL_OBJECTS.botsRef;
const BOTS_SUBJECT = "bots rule";
const SLOTS_FULL = "the zone's plan allows no further custom rule and other rules hold every slot";

/** The guards an install wants. */
interface DesiredGuards {
  /** The hostnames the rules read. */
  readonly layout: DomainLayout;

  /** The zone's plan, which sets how many custom rules the zone may hold. */
  readonly plan: ZonePlan;

  /** `blocked` stops a page of another domain from framing a site or loading its files; a page under the same domain reaches the Worker. */
  readonly outsidePages: "blocked" | "allowed";

  /** Whether the crawlers of search engines pass the bots rule; every other verified bot is stopped either way. */
  readonly searchEnginesAllowed: boolean;
}

function held(steps: readonly RuleStep[], kind: RuleStep["kind"]): number {
  return steps.filter((step) => step.kind === kind).length;
}

/**
 * Write the expression of the outside pages rule: true for a request to a site that a page of another site made.
 *
 * @returns an expression false for a request that lacks either Fetch Metadata header, for one from the same site, and for a cross-site one that opens a document
 * @throws {Error} a hostname or suffix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function outsidePagesExpression(layout: DomainLayout): string {
  return `ends_with(http.host, ${quoted(siteEnding(layout))}) and ${INSTALL_OBJECTS.outsideCondition}`;
}

/**
 * Write the expression of the bots rule: true for a request to a site from a bot Cloudflare has verified.
 *
 * @returns an expression false for every bot Cloudflare has not verified, whatever it is
 * @throws {Error} a hostname or suffix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function botsExpression(layout: DomainLayout, searchEnginesAllowed: boolean): string {
  const verified = `ends_with(http.host, ${quoted(siteEnding(layout))}) and ${INSTALL_OBJECTS.botsCondition}`;
  if (!searchEnginesAllowed) return verified;

  return `${verified} and ${INSTALL_OBJECTS.searchEnginesPass}`;
}

/**
 * Compute the rule changes the guards need.
 *
 * @param current - the entry point ruleset of the custom rules phase as it is now
 * @returns the outside pages rule's step, if any, then the bots rule's; a rule the plan has no slot for is skipped with its reason, and no step names a rule poplin did not make
 */
export function planGuards(desired: DesiredGuards, current: PhaseRules | undefined): RuleStep[] {
  const slots = CUSTOM_RULE_SLOTS[desired.plan];
  const taken = current?.rules.length ?? 0;
  const outsideRule = {
    ref: OUTSIDE_REF,
    description: INSTALL_OBJECTS.outsideDescription,
    expression: outsidePagesExpression(desired.layout),
    action: "block",
    enabled: true,
  } as const;
  const botsRule = {
    ref: BOTS_REF,
    description: INSTALL_OBJECTS.botsDescription,
    expression: botsExpression(desired.layout, desired.searchEnginesAllowed),
    action: "block",
    enabled: true,
  } as const;

  let outside = removeOwnRule(OUTSIDE_SUBJECT, OUTSIDE_REF, current);
  if (desired.outsidePages === "blocked")
    outside = [planOwnRule({ subject: OUTSIDE_SUBJECT, rule: outsideRule, hasRoom: taken < slots, full: SLOTS_FULL }, current)];

  // The first rule's step has run by the time the second is sent, so its slot is counted.
  const takenThen = taken + held(outside, "create") - held(outside, "remove");
  const bots = planOwnRule({ subject: BOTS_SUBJECT, rule: botsRule, hasRoom: takenThen < slots, full: SLOTS_FULL }, current);

  return [...outside, bots];
}

/**
 * Make the zone's guard rules match an install.
 *
 * @returns what was created, changed, left, or removed; a rule the plan has no slot for is a skip with its reason, never a failure
 */
export function syncGuards(connection: Connection, zoneId: string, desired: DesiredGuards): Promise<Synced> {
  return syncPhase(connection, zoneId, CUSTOM_PHASE, (current) => planGuards(desired, current));
}
