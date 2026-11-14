// The rules poplin owns in a phase of the zone. Each carries a fixed `ref`, the name the Rulesets API keeps on a rule, and poplin changes no rule without it.

import { BasePhases } from "cloudflare/resources/rulesets/phases/phases";
import { BaseRules } from "cloudflare/resources/rulesets/rules";
import { BaseRulesets } from "cloudflare/resources/rulesets/rulesets";
import { type CloudflareResult, type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { applySteps, reportOf, type Synced } from "../sync";

const NOT_FOUND_STATUS = 404;
const LITERAL = /^[a-z0-9.-]+$/;
const NEW_RULESET_NAMES = { http_ratelimit: INSTALL_OBJECTS.rateRuleset, http_request_firewall_custom: INSTALL_OBJECTS.guardRuleset } as const;

/** The phases poplin keeps a rule in: the rate limiting rules, and the custom rules that run before them. */
type Phase = keyof typeof NEW_RULESET_NAMES;

/** How a rate rule counts and for how long it blocks. */
interface RateLimit {
  readonly characteristics: string[];
  readonly period: number;
  readonly requests_per_period: number;
  readonly mitigation_timeout: number;
}

/** A rule as poplin writes it; `ratelimit` is present on a rate rule alone. */
export interface RuleBody {
  readonly ref: string;
  readonly description: string;
  readonly expression: string;
  readonly action: "block";
  readonly enabled: true;
  readonly ratelimit?: RateLimit;
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
export interface PhaseRules {
  readonly id: string;
  readonly rules: readonly ZoneRule[];
}

/** A rule poplin wants in a phase. `hasRoom` says whether the plan allows one more rule there, and `full` is the reason given when it does not. */
interface OwnRule {
  readonly subject: string;
  readonly rule: RuleBody;
  readonly hasRoom: boolean;
  readonly full: string;
}

/** One step of a rules plan; `subject` names the rule. A `create` with no `rulesetId` makes the phase's ruleset too. */
export type RuleStep =
  | { readonly kind: "create"; readonly subject: string; readonly rulesetId: string | undefined; readonly rule: RuleBody }
  | { readonly kind: "change"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string; readonly rule: RuleBody }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "remove"; readonly subject: string; readonly rulesetId: string; readonly ruleId: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function sameLimit(limit: ZoneRule["ratelimit"], wanted: RateLimit | undefined): boolean {
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

/**
 * Write a hostname or a suffix as a string of the rule language.
 *
 * @throws {Error} a hostname or suffix that was cast instead of checked holds a character outside `a-z`, `0-9`, `.`, and `-`
 */
export function quoted(text: string): string {
  // The brand already proves these characters; the check holds the line if a string is ever cast to one.
  if (!LITERAL.test(text)) throw new Error("only a checked hostname or suffix may enter a rule expression");

  return `"${text}"`;
}

/**
 * Compute the removal of a rule poplin no longer wants.
 *
 * @returns one `remove` for the rule with this `ref`, or no step when the phase has none
 */
export function removeOwnRule(subject: string, ref: string, current: PhaseRules | undefined): RuleStep[] {
  const own = current?.rules.find((rule) => rule.ref === ref);
  if (current === undefined || own === undefined) return [];

  return [{ kind: "remove", subject, rulesetId: current.id, ruleId: own.id }];
}

/**
 * Compute the step that makes one rule of poplin's match what it wants.
 *
 * @param current - the phase's entry point ruleset as it is now
 * @returns a step that names the rule with the wanted `ref` and no other rule of the phase
 */
export function planOwnRule(wanted: OwnRule, current: PhaseRules | undefined): RuleStep {
  const own = current?.rules.find((rule) => rule.ref === wanted.rule.ref);

  if (current === undefined || own === undefined) {
    if (!wanted.hasRoom) return { kind: "skip", subject: wanted.subject, reason: wanted.full };

    return { kind: "create", subject: wanted.subject, rulesetId: current?.id, rule: wanted.rule };
  }

  if (sameRule(own, wanted.rule)) return { kind: "leave", subject: wanted.subject };

  return { kind: "change", subject: wanted.subject, rulesetId: current.id, ruleId: own.id, rule: wanted.rule };
}

async function readPhase(connection: Connection, zoneId: string, phase: Phase): Promise<CloudflareResult<PhaseRules | undefined>> {
  const ruleset = await callCloudflare(connection, (api) => new BasePhases(api).get(phase, { zone_id: zoneId }));
  if (ruleset.ok) return { ok: true, value: { id: ruleset.value.id, rules: (ruleset.value.rules ?? []).map((rule) => ({ ...rule, id: rule.id ?? "" })) } };

  // Cloudflare answers 404 for a phase that never had a rule.
  if (ruleset.failure === "refused" && ruleset.status === NOT_FOUND_STATUS) return { ok: true, value: undefined };

  return ruleset;
}

// Each change is sent for one rule by its id, so the phase's other rules are in no request.
async function applyRuleSteps(connection: Connection, zoneId: string, phase: Phase, steps: readonly RuleStep[]): Promise<Synced> {
  // A phase with no ruleset gets its new rules in the one request that makes the ruleset.
  const founding = steps.filter((step) => step.kind === "create" && step.rulesetId === undefined);
  const foundingRules = founding.flatMap((step) => (step.kind === "create" ? [step.rule] : []));

  return applySteps(steps, async (step) => {
    if (step.kind === "remove")
      return callCloudflare(connection, (api) => new BaseRules(api).delete(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId }));

    if (step.kind === "change")
      return callCloudflare(connection, (api) => new BaseRules(api).edit(step.ruleId, { zone_id: zoneId, ruleset_id: step.rulesetId, ...step.rule }));

    const rulesetId = step.rulesetId;
    if (rulesetId !== undefined) return callCloudflare(connection, (api) => new BaseRules(api).create(rulesetId, { zone_id: zoneId, ...step.rule }));

    // The first founding step sent this rule already.
    if (step !== founding[0]) return { ok: true, value: undefined };

    return callCloudflare(connection, (api) => new BaseRulesets(api).create({ zone_id: zoneId, kind: "zone", phase, name: NEW_RULESET_NAMES[phase], rules: foundingRules }));
  });
}

/**
 * Make poplin's rules in one phase of the zone match a plan.
 *
 * @param plan - computes the steps from the phase's entry point ruleset as it is now; a phase that never had a rule has none
 * @returns what was created, changed, left, removed, and skipped, or the failure with the report of the steps done before it
 */
export async function syncPhase(connection: Connection, zoneId: string, phase: Phase, plan: (current: PhaseRules | undefined) => RuleStep[]): Promise<Synced> {
  const current = await readPhase(connection, zoneId, phase);
  if (!current.ok) return { ...current, report: reportOf([]) };

  return applyRuleSteps(connection, zoneId, phase, plan(current.value));
}
