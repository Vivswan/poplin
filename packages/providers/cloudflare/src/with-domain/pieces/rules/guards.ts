// The two custom rules that stop a request before the Worker runs, so it costs the install nothing. Both read the site hostnames alone, never the admin hostname.
// The bots rule also stops what no static site answers: a method other than GET and HEAD, and the paths scanners ask every host for.
// A browser calls every hostname under one domain the same site, so the outside pages rule stops pages of other domains and the Worker refuses the rest.

import type { Connection, ZonePlan } from "../../../shared/install/client";
import { INSTALL_OBJECTS } from "../../../shared/install/install-objects";
import { type DomainLayout, siteEndings } from "../../layout";
import { type PhaseRules, planOwnRule, type RuleStep, removeOwnRule, sitesExpression, syncPhase } from "./rules";
import type { Mode, Synced } from "../../../shared/install/sync";

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
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function outsidePagesExpression(layout: DomainLayout): string {
  return `${sitesExpression(siteEndings(layout))} and ${INSTALL_OBJECTS.outsideCondition}`;
}

/**
 * Write the expression of the bots rule: true for a request to a site from a bot Cloudflare has verified, with a method other than GET and HEAD, or for a path of the scanner list.
 *
 * @returns an expression false for every request to the admin hostname and for every path under `/cdn-cgi/`, where Cloudflare's own login answers
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function botsExpression(layout: DomainLayout, searchEnginesAllowed: boolean): string {
  const bots = searchEnginesAllowed ? `(${INSTALL_OBJECTS.botsCondition} and ${INSTALL_OBJECTS.searchEnginesPass})` : INSTALL_OBJECTS.botsCondition;
  const stopped = `${bots} or ${INSTALL_OBJECTS.otherMethods} or ${INSTALL_OBJECTS.scannerPaths.join(" or ")}`;

  return `${sitesExpression(siteEndings(layout))} and ${INSTALL_OBJECTS.edgePaths} and (${stopped})`;
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
 * @param mode - `plan` reads the custom rules phase and sends no change
 * @returns what was created, changed, left, or removed; a rule the plan has no slot for is a skip with its reason, never a failure
 */
export function syncGuards(connection: Connection, zoneId: string, desired: DesiredGuards, mode: Mode): Promise<Synced> {
  return syncPhase(connection, zoneId, CUSTOM_PHASE, (current) => planGuards(desired, current), mode);
}
