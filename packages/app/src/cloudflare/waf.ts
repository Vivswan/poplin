// The zone's two WAF rules. Each carries a fixed `ref`, the name the Rulesets API keeps on a rule, and poplin changes no rule without it.

import { BasePhases } from "cloudflare/resources/rulesets/phases/phases";
import { BaseRules } from "cloudflare/resources/rulesets/rules";
import { BaseRulesets } from "cloudflare/resources/rulesets/rulesets";
import { type CloudflareResult, type Connection, callCloudflare, type ZonePlan } from "./client";
import type { Hostname } from "./hostname";
import { type DomainLayout, ownHostnames, siteParent } from "./layout";
import { applySteps, reportOf, type Synced } from "./sync";

const NOT_FOUND_STATUS = 404;
const MAX_EXPRESSION_LENGTH = 4096;
const HOST_REF = "poplin_host";
const RATE_REF = "poplin_rate";
const HOST_SUBJECT = "host rule";
const RATE_SUBJECT = "rate rule";
const HOST_PHASE = "http_request_firewall_custom";
const RATE_PHASE = "http_ratelimit";
const RATE_LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const RATE_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 1, pro: 2, business: 5, enterprise: 100 };
const LITERAL = /^[a-z0-9.-]+$/;
const CANNOT_TELL_SITES = "no prefix sets a site apart from a made-up hostname, so the rule would block nothing";
const LIST_TOO_LONG = "the zone's other hostnames do not fit in one rule expression";
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "the Free plan's rate rule would also limit this zone's other hostnames";

type Phase = typeof HOST_PHASE | typeof RATE_PHASE;

/** A rule as poplin writes it. */
interface RuleBody {
  readonly ref: string;
  readonly description: string;
  readonly expression: string;
  readonly action: "block";
  readonly enabled: true;
  readonly ratelimit?: typeof RATE_LIMIT;
}

/** A rule as the zone has it now. */
interface ZoneRule {
  readonly id: string;
  readonly ref?: string;
  readonly description?: string;
  readonly expression?: string;
  readonly action?: string;
  readonly enabled?: boolean;
  readonly ratelimit?: {
    readonly characteristics: readonly string[];
    readonly period: number;
    readonly requests_per_period?: number;
    readonly mitigation_timeout?: number;
    readonly counting_expression?: string;
  };
}

/** A phase's entry point ruleset; a zone that never had a rule in the phase has none. */
interface PhaseRules {
  readonly id: string;
  readonly rules: readonly ZoneRule[];
}

/** The two phases poplin writes to, as the zone has them now. */
interface ZoneRules {
  readonly custom: PhaseRules | undefined;
  readonly rate: PhaseRules | undefined;
}

/** The rules an install wants. `listed` is the zone's other hostnames. */
interface DesiredRules {
  readonly layout: DomainLayout;
  readonly listed: readonly Hostname[];
  readonly plan: ZonePlan;
}

/** One step of a rules plan; `subject` is `host rule` or `rate rule`. A `create` with no `rulesetId` makes the phase's ruleset too. */
type RuleStep =
  | { readonly kind: "create"; readonly subject: string; readonly phase: Phase; readonly rulesetId: string | undefined; readonly rule: RuleBody }
  | { readonly kind: "change"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string; readonly rule: RuleBody }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "remove"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

/** A rule poplin wants in a phase, or the reason it wants none there. */
type Wanted = { readonly rule: RuleBody } | { readonly reason: string };

// The brand already proves these characters; the check holds the line if a string is ever cast to one.
function quoted(text: string): string {
  if (!LITERAL.test(text)) throw new Error("only a checked hostname or prefix may enter a rule expression");

  return `"${text}"`;
}

function hostIn(hostnames: readonly Hostname[]): string {
  const literals = [...new Set(hostnames)].sort().map(quoted);

  return `http.host in {${literals.join(" ")}}`;
}

function under(parent: Hostname): string {
  return `ends_with(http.host, ${quoted(`.${parent}`)})`;
}

function sites(layout: DomainLayout): string {
  if (layout.names !== "domain" || layout.prefix === "") return under(siteParent(layout));

  return `${under(layout.domain)} and starts_with(http.host, ${quoted(layout.prefix)})`;
}

// A subdomain layout always can: its admin hostname is never under the pages hostname.
function tellsSites(layout: DomainLayout): boolean {
  return layout.names !== "domain" || layout.prefix !== "";
}

function sameLimit(limit: ZoneRule["ratelimit"], wanted: RuleBody["ratelimit"]): boolean {
  if (limit === undefined || wanted === undefined) return limit === wanted;

  const sameNumbers =
    limit.period === wanted.period && limit.requests_per_period === wanted.requests_per_period && limit.mitigation_timeout === wanted.mitigation_timeout;

  // A counting expression would count other requests than the ones the rule matches.
  const countsMatches = (limit.counting_expression ?? "") === "";

  return sameNumbers && countsMatches && [...limit.characteristics].sort().join(" ") === wanted.characteristics.join(" ");
}

function sameRule(rule: ZoneRule, body: RuleBody): boolean {
  const sameText = rule.expression === body.expression && rule.description === body.description;

  return sameText && rule.action === body.action && rule.enabled !== false && sameLimit(rule.ratelimit, body.ratelimit);
}

function planRule(subject: string, phase: Phase, current: PhaseRules | undefined, wanted: Wanted, ref: string): RuleStep {
  const own = current?.rules.find((rule) => rule.ref === ref);

  if (current === undefined || own === undefined) {
    if ("reason" in wanted) return { kind: "skip", subject, reason: wanted.reason };

    return { kind: "create", subject, phase, rulesetId: current?.id, rule: wanted.rule };
  }

  // A rule poplin no longer wants would go on blocking with a stale list.
  if ("reason" in wanted) return { kind: "remove", subject, rulesetId: current.id, ruleId: own.id };

  if (sameRule(own, wanted.rule)) return { kind: "leave", subject };

  return { kind: "change", subject, rulesetId: current.id, ruleId: own.id, rule: wanted.rule };
}

async function readPhase(connection: Connection, zoneId: string, phase: Phase): Promise<CloudflareResult<PhaseRules | undefined>> {
  const ruleset = await callCloudflare(connection, (api) => new BasePhases(api).get(phase, { zone_id: zoneId }));
  if (ruleset.ok) return { ok: true, value: { id: ruleset.value.id, rules: (ruleset.value.rules ?? []).map((rule) => ({ ...rule, id: rule.id ?? "" })) } };

  // Cloudflare answers 404 for a phase that never had a rule.
  if (ruleset.failure === "refused" && ruleset.status === NOT_FOUND_STATUS) return { ok: true, value: undefined };

  return ruleset;
}

/**
 * Write the expression of the host rule: true for every hostname under the domain that is no site, not the Worker's own, and not listed.
 *
 * @param listed - the zone's other hostnames, which keep their own origin
 * @returns the expression, or `undefined` when the layout cannot tell a site from a made-up hostname
 * @throws {Error} a hostname or prefix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function hostRuleExpression(layout: DomainLayout, listed: readonly Hostname[]): string | undefined {
  if (!tellsSites(layout)) return undefined;

  return `${under(layout.domain)} and not (${sites(layout)}) and not ${hostIn([...ownHostnames(layout), ...listed])}`;
}

/**
 * Write the expression of the rate rule: true for the requests the Worker answers.
 *
 * @returns on the Free plan, whose rate rules may read the path alone, an expression true for every request of the zone; the plan uses it only for a zone with no other hostname
 * @throws {Error} a hostname or prefix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function rateRuleExpression(layout: DomainLayout, listed: readonly Hostname[], plan: ZonePlan): string {
  if (plan === "free") return 'http.request.uri.path contains "/"';

  const served = `(${sites(layout)}) or ${hostIn(ownHostnames(layout))}`;
  if (listed.length === 0) return served;

  return `(${served}) and not ${hostIn(listed)}`;
}

function wantedHostRule(desired: DesiredRules): Wanted {
  const expression = hostRuleExpression(desired.layout, desired.listed);
  if (expression === undefined) return { reason: CANNOT_TELL_SITES };

  if (expression.length > MAX_EXPRESSION_LENGTH) return { reason: LIST_TOO_LONG };

  return { rule: { ref: HOST_REF, description: "poplin: block hostnames that are no site", expression, action: "block", enabled: true } };
}

function wantedRateRule(desired: DesiredRules, current: PhaseRules | undefined): Wanted {
  if (desired.plan === "free" && desired.listed.length > 0) return { reason: LIMITS_OTHERS };

  const others = current?.rules.filter((rule) => rule.ref !== RATE_REF).length ?? 0;
  const held = current?.rules.some((rule) => rule.ref === RATE_REF) ?? false;
  if (!held && others >= RATE_RULE_SLOTS[desired.plan]) return { reason: SLOT_TAKEN };

  const expression = rateRuleExpression(desired.layout, desired.listed, desired.plan);
  if (expression.length > MAX_EXPRESSION_LENGTH) return { reason: LIST_TOO_LONG };

  return { rule: { ref: RATE_REF, description: "poplin: limit requests per address", expression, action: "block", enabled: true, ratelimit: RATE_LIMIT } };
}

/**
 * Compute the rule changes an install needs.
 *
 * @param current - the entry point rulesets of the custom rule and rate limiting phases as they are now
 * @returns the host rule's step, then the rate rule's; a rule poplin wants none of is skipped with its reason, or removed when an earlier run made it
 */
export function planWaf(desired: DesiredRules, current: ZoneRules): RuleStep[] {
  return [
    planRule(HOST_SUBJECT, HOST_PHASE, current.custom, wantedHostRule(desired), HOST_REF),
    planRule(RATE_SUBJECT, RATE_PHASE, current.rate, wantedRateRule(desired, current.rate), RATE_REF),
  ];
}

/**
 * Make the zone's two WAF rules match an install.
 *
 * @returns what was created, changed, left, and removed; a rate rule poplin cannot have, or would have to widen to the zone's other hostnames, is a skip with its reason, never a failure
 */
export async function syncWaf(connection: Connection, zoneId: string, desired: DesiredRules): Promise<Synced> {
  const custom = await readPhase(connection, zoneId, HOST_PHASE);
  if (!custom.ok) return { ...custom, report: reportOf([]) };

  const rate = await readPhase(connection, zoneId, RATE_PHASE);
  if (!rate.ok) return { ...rate, report: reportOf([]) };

  return applySteps(planWaf(desired, { custom: custom.value, rate: rate.value }), (step) => {
    if (step.kind === "remove")
      return callCloudflare(connection, (api) => new BaseRules(api).delete(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId }));

    if (step.kind === "change")
      return callCloudflare(connection, (api) => new BaseRules(api).edit(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId, ...step.rule }));

    const rulesetId = step.rulesetId;
    if (rulesetId !== undefined) return callCloudflare(connection, (api) => new BaseRules(api).create(rulesetId, { zone_id: zoneId, ...step.rule }));

    return callCloudflare(connection, (api) =>
      new BaseRulesets(api).create({ zone_id: zoneId, kind: "zone", phase: step.phase, name: "default", rules: [step.rule] }),
    );
  });
}
