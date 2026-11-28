// The three custom rules that stop a request before the Worker runs, so it costs the install nothing. The first two read the site hostnames alone, the third the admin hostname alone.
// The bots rule stops a verified bot, but never an assistant that opens one page for a person or a chat app that fetches a shared link for its preview, nor a search engine's crawler where those are allowed.
// It also stops what no static site answers: a method other than GET and HEAD, and the paths scanners ask every host for.
// A browser calls every hostname under one domain the same site, so the outside pages rule stops pages of other domains and the Worker refuses the rest.
// The API rule stops a call to the API that carries no `Authorization` header, but for the two routes a machine with no token calls to get one. The Worker checks the token itself on every other call.

import type { Connection, ZonePlan } from "../../../shared/install/client";
import { INSTALL_OBJECTS } from "../../../shared/install/install-objects";
import { type DomainLayout, siteEndings } from "../../layout";
import { type PhaseRules, planOwnRule, quoted, type RuleBody, type RuleStep, removeOwnRule, sitesExpression, syncPhase } from "./rules";
import type { Mode, Synced } from "../../../shared/install/sync";

const CUSTOM_PHASE = "http_request_firewall_custom";
const CUSTOM_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 5, pro: 20, business: 100, enterprise: 1000 };
const OUTSIDE_REF = INSTALL_OBJECTS.outsideRef;
const OUTSIDE_SUBJECT = "outside pages rule";
const BOTS_REF = INSTALL_OBJECTS.botsRef;
const BOTS_SUBJECT = "bots rule";
const API_REF = INSTALL_OBJECTS.apiRef;
const API_SUBJECT = "API rule";
const SLOTS_FULL = "the zone's plan allows no further custom rule and other rules hold every slot";

/** The guards an install wants. */
interface DesiredGuards {
  /** The hostnames the rules read. */
  readonly layout: DomainLayout;

  /** The zone's plan, which sets how many custom rules the zone may hold. */
  readonly plan: ZonePlan;

  /** `blocked` stops a page of another domain from framing a site or loading its files; a page under the same domain reaches the Worker. */
  readonly outsidePages: "blocked" | "allowed";

  /** Whether the crawlers of search engines pass the bots rule; an assistant that opens a page for its user and a fetch for a link preview pass either way, and every other verified bot is stopped either way. */
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
 * A verified bot of Cloudflare's kind `AI Assistant`, which opens one page when its user asks for it, or `Page Preview`, which fetches a shared link to show its preview, is never stopped as a bot.
 *
 * @returns an expression false for every request to the admin hostname and for every path under `/cdn-cgi/`, where Cloudflare's own login answers
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function botsExpression(layout: DomainLayout, searchEnginesAllowed: boolean): string {
  const always = [INSTALL_OBJECTS.assistantsPass, INSTALL_OBJECTS.previewsPass];
  const passing = searchEnginesAllowed ? [...always, INSTALL_OBJECTS.searchEnginesPass] : always;
  const bots = `(${[INSTALL_OBJECTS.botsCondition, ...passing].join(" and ")})`;
  const stopped = `${bots} or ${INSTALL_OBJECTS.otherMethods} or ${INSTALL_OBJECTS.scannerPaths.join(" or ")}`;

  return `${sitesExpression(siteEndings(layout))} and ${INSTALL_OBJECTS.edgePaths} and (${stopped})`;
}

/**
 * Write the expression of the API rule: true for a request to `/api` of the admin hostname that carries no `Authorization` header, but for the two routes a login goes through.
 *
 * The header map's keys are lowercased by Cloudflare, where the list of header names keeps a client's case. The Worker takes the scheme in any case, so the edge reads only that the header is there.
 * The Worker refuses a header that holds no live token.
 *
 * @returns an expression false for every site hostname, for every path of the admin hostname outside `/api`, for `/api/logins` and `/api/logins/token`, and for a call that carries the header
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function apiExpression(layout: DomainLayout): string {
  return `http.host eq ${quoted(layout.adminHostname)} and ${INSTALL_OBJECTS.apiPaths} and ${INSTALL_OBJECTS.loginRoutesPass} and ${INSTALL_OBJECTS.noTokenHeader}`;
}

/**
 * Write the API rule as poplin wants it in the zone.
 *
 * @throws {Error} a hostname that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function apiRule(layout: DomainLayout): RuleBody {
  return { ref: API_REF, description: INSTALL_OBJECTS.apiDescription, expression: apiExpression(layout), action: "block", enabled: true };
}

/**
 * Compute the rule changes the guards need.
 *
 * @param current - the entry point ruleset of the custom rules phase as it is now
 * @returns the outside pages rule's step, if any, then the bots rule's, then the API rule's; a rule the plan has no slot for is skipped with its reason, and no step names a rule poplin did not make
 */
export function planGuards(desired: DesiredGuards, current: PhaseRules | undefined): RuleStep[] {
  const slots = CUSTOM_RULE_SLOTS[desired.plan];
  const taken = current?.rules.length ?? 0;
  // Each rule's step has run by the time the next is sent, so its slot is counted.
  const takenAfter = (steps: readonly RuleStep[]): number => taken + held(steps, "create") - held(steps, "remove");
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

  const bots = planOwnRule({ subject: BOTS_SUBJECT, rule: botsRule, hasRoom: takenAfter(outside) < slots, full: SLOTS_FULL }, current);
  const api = planOwnRule({ subject: API_SUBJECT, rule: apiRule(desired.layout), hasRoom: takenAfter([...outside, bots]) < slots, full: SLOTS_FULL }, current);

  return [...outside, bots, api];
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
