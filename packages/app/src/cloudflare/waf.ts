// The zone's rate rule. It carries a fixed `ref`, the name the Rulesets API keeps on a rule, and poplin changes no rule without it.

import { BasePhases } from "cloudflare/resources/rulesets/phases/phases";
import { BaseRules } from "cloudflare/resources/rulesets/rules";
import { BaseRulesets } from "cloudflare/resources/rulesets/rulesets";
import { type CloudflareResult, type Connection, callCloudflare, type ZonePlan } from "./client";
import { type DomainLayout, siteEnding } from "./layout";
import { applySteps, reportOf, type Synced } from "./sync";

const NOT_FOUND_STATUS = 404;
const RATE_REF = "poplin_rate";
const RATE_SUBJECT = "rate rule";
const RATE_PHASE = "http_ratelimit";
const RATE_LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };
const RATE_RULE_SLOTS: Readonly<Record<ZonePlan, number>> = { free: 1, pro: 2, business: 5, enterprise: 100 };
const LITERAL = /^[a-z0-9.-]+$/;
const SLOT_TAKEN = "the zone's plan allows no further rate rule and other rules hold every slot";
const LIMITS_OTHERS = "the Free plan's rate rule would also limit this zone's other hostnames";

/** The rate rule as poplin writes it. */
interface RuleBody {
  readonly ref: string;
  readonly description: string;
  readonly expression: string;
  readonly action: "block";
  readonly enabled: true;
  readonly ratelimit: typeof RATE_LIMIT;
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

/** The rate limiting phase's entry point ruleset; a zone that never had a rate rule has none. */
interface PhaseRules {
  readonly id: string;
  readonly rules: readonly ZoneRule[];
}

/** The rule an install wants. `sharesZone` says whether the zone has hostnames of its own. */
interface DesiredRules {
  readonly layout: DomainLayout;
  readonly plan: ZonePlan;
  readonly sharesZone: boolean;
}

/** One step of a rules plan; `subject` is `rate rule`. A `create` with no `rulesetId` makes the phase's ruleset too. */
type RuleStep =
  | { readonly kind: "create"; readonly subject: string; readonly rulesetId: string | undefined; readonly rule: RuleBody }
  | { readonly kind: "change"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string; readonly rule: RuleBody }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "remove"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

// The brand already proves these characters; the check holds the line if a string is ever cast to one.
function quoted(text: string): string {
  if (!LITERAL.test(text)) throw new Error("only a checked hostname or suffix may enter a rule expression");

  return `"${text}"`;
}

function sameLimit(limit: ZoneRule["ratelimit"], wanted: RuleBody["ratelimit"]): boolean {
  if (limit === undefined) return false;

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

async function readPhase(connection: Connection, zoneId: string): Promise<CloudflareResult<PhaseRules | undefined>> {
  const ruleset = await callCloudflare(connection, (api) => new BasePhases(api).get(RATE_PHASE, { zone_id: zoneId }));
  if (ruleset.ok) return { ok: true, value: { id: ruleset.value.id, rules: (ruleset.value.rules ?? []).map((rule) => ({ ...rule, id: rule.id ?? "" })) } };

  // Cloudflare answers 404 for a phase that never had a rule.
  if (ruleset.failure === "refused" && ruleset.status === NOT_FOUND_STATUS) return { ok: true, value: undefined };

  return ruleset;
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
  const own = current?.rules.find((rule) => rule.ref === RATE_REF);
  const others = current?.rules.filter((rule) => rule.ref !== RATE_REF).length ?? 0;

  if (desired.plan === "free" && desired.sharesZone) {
    if (current === undefined || own === undefined) return [{ kind: "skip", subject: RATE_SUBJECT, reason: LIMITS_OTHERS }];

    // The whole-zone rule an earlier run made would go on limiting the hostnames the zone has since gained.
    return [
      { kind: "remove", subject: RATE_SUBJECT, rulesetId: current.id, ruleId: own.id },
      { kind: "skip", subject: RATE_SUBJECT, reason: LIMITS_OTHERS },
    ];
  }

  const expression = rateRuleExpression(desired.layout, desired.plan);
  const rule: RuleBody = {
    ref: RATE_REF,
    description: "poplin: limit requests per address",
    expression,
    action: "block",
    enabled: true,
    ratelimit: RATE_LIMIT,
  };

  if (current === undefined || own === undefined) {
    if (others >= RATE_RULE_SLOTS[desired.plan]) return [{ kind: "skip", subject: RATE_SUBJECT, reason: SLOT_TAKEN }];

    return [{ kind: "create", subject: RATE_SUBJECT, rulesetId: current?.id, rule }];
  }

  if (sameRule(own, rule)) return [{ kind: "leave", subject: RATE_SUBJECT }];

  return [{ kind: "change", subject: RATE_SUBJECT, rulesetId: current.id, ruleId: own.id, rule }];
}

/**
 * Make the zone's rate rule match an install.
 *
 * @returns what was created, changed, left, or removed; a rate rule poplin cannot have, or would have to widen to the zone's other hostnames, is a skip with its reason, never a failure
 */
export async function syncWaf(connection: Connection, zoneId: string, desired: DesiredRules): Promise<Synced> {
  const rate = await readPhase(connection, zoneId);
  if (!rate.ok) return { ...rate, report: reportOf([]) };

  return applySteps(planWaf(desired, rate.value), (step) => {
    if (step.kind === "remove")
      return callCloudflare(connection, (api) => new BaseRules(api).delete(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId }));

    if (step.kind === "change")
      return callCloudflare(connection, (api) => new BaseRules(api).edit(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId, ...step.rule }));

    const rulesetId = step.rulesetId;
    if (rulesetId !== undefined) return callCloudflare(connection, (api) => new BaseRules(api).create(rulesetId, { zone_id: zoneId, ...step.rule }));

    return callCloudflare(connection, (api) =>
      new BaseRulesets(api).create({ zone_id: zoneId, kind: "zone", phase: RATE_PHASE, name: "default", rules: [step.rule] }),
    );
  });
}
