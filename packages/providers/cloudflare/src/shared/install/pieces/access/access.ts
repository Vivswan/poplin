// The install's two Access applications, each with the one policy it holds. Access keeps no mark on any of the four, so poplin's are the ones with its fixed names.
//
//   poplin              the whole dashboard hostname and every private site's address   poplin logins: allow, the install's logins
//   poplin open paths   the paths of the dashboard hostname a program reaches            poplin open paths policy: bypass, everyone
//
// Access takes the longer path first, so an open path passes to the Worker with no login, where the API checks its own token.

import type { Logins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";
import { BaseOrganizations } from "cloudflare/resources/zero-trust/organizations/organizations";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** The name that marks the logins' policy as poplin's. */
const POLICY_NAME = INSTALL_OBJECTS.accessPolicy;

/** The name that marks the guarded application as poplin's. */
const APPLICATION_NAME = INSTALL_OBJECTS.accessApplication;

/** The name that marks the policy that lets everyone through as poplin's. */
const OPEN_POLICY_NAME = INSTALL_OBJECTS.accessOpenPolicy;

/** The name that marks the application over the open paths as poplin's. */
const OPEN_APPLICATION_NAME = INSTALL_OBJECTS.accessOpenApplication;

/** What Cloudflare's refusal says on an account whose Access was never switched on. */
export const ACCESS_NOT_ENABLED = "access.api.error.not_enabled";

/** How Access keeps a person's login: its cookie's lifetime and the two cookie attributes a browser enforces. */
const SESSION = {
  session_duration: INSTALL_OBJECTS.accessSession,
  http_only_cookie_attribute: INSTALL_OBJECTS.accessHttpOnly,
  same_site_cookie_attribute: INSTALL_OBJECTS.accessSameSite,
} as const;

/** A reusable policy as the account has it now. */
interface AccountPolicy {
  readonly id: string;
  readonly name?: string;
  readonly decision?: string;
  readonly include?: readonly unknown[];
  readonly exclude?: readonly unknown[];
  readonly require?: readonly unknown[];
}

/** An application as the account has it now. */
interface AccountApplication {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly domain?: string;
  readonly destinations?: readonly { readonly type?: string; readonly uri?: string; readonly overrides?: readonly unknown[] }[];
  readonly policies?: readonly { readonly id?: string }[];
  readonly session_duration?: string;
  readonly http_only_cookie_attribute?: boolean;
  readonly same_site_cookie_attribute?: string;
}

/** What the account's Access holds now. */
interface AccountAccess {
  readonly policies: readonly AccountPolicy[];
  readonly applications: readonly AccountApplication[];
}

/** The login an install wants. */
interface DesiredAccess {
  /** The admin hostname: all of it is behind the login but its open paths. */
  readonly hostname: Hostname;

  /** The emails let through. */
  readonly logins: Logins;

  /** What every private site answers at: the hostname pattern from `privateSitesPattern`, or on an install without a domain the private host whole. */
  readonly privateSites: string;
}

/** What the Worker checks a login's token against. `teamDomain` is the hostname alone, such as `team.cloudflareaccess.com`. */
interface LoginFacts {
  readonly teamDomain: string;
  readonly audience: string;
}

/** A rule of a policy poplin writes: one email, or everyone. */
type Rule = { readonly email: { readonly email: string } } | { readonly everyone: Readonly<Record<string, never>> };

/** A policy poplin wants: its name, what it decides, and exactly whom it includes. */
interface WantedPolicy {
  readonly subject: typeof POLICY_NAME | typeof OPEN_POLICY_NAME;
  readonly decision: "allow" | "bypass";
  readonly include: readonly Rule[];
}

/** An application poplin wants: its name, its addresses in order, and the name of the one policy it holds. */
interface WantedApplication {
  readonly subject: typeof APPLICATION_NAME | typeof OPEN_APPLICATION_NAME;
  readonly uris: readonly string[];
  readonly policy: WantedPolicy["subject"];
}

/** One step of an Access plan. An application step with no `policyId` links the policy the same plan creates. */
type AccessStep =
  | ({ readonly kind: "create" } & WantedPolicy)
  | ({ readonly kind: "change"; readonly id: string } & WantedPolicy)
  | ({ readonly kind: "create"; readonly policyId: string | undefined } & WantedApplication)
  | ({ readonly kind: "change"; readonly id: string; readonly policyId: string | undefined } & WantedApplication)
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function emailOf(rule: object): string | undefined {
  const email = "email" in rule ? rule.email : undefined;
  if (typeof email !== "object" || email === null || !("email" in email) || typeof email.email !== "string") return undefined;

  return email.email;
}

/** A rule as one text, alike for a rule poplin writes and one Cloudflare answers; `undefined` for a rule of any other kind, which no policy of poplin's holds. */
function ruleText(rule: unknown): string | undefined {
  if (typeof rule !== "object" || rule === null) return undefined;

  const kinds = Object.keys(rule).join();
  if (kinds === "everyone") return kinds;

  const email = kinds === "email" ? emailOf(rule) : undefined;

  return email === undefined ? undefined : `email ${email}`;
}

function decidesExactly(policy: AccountPolicy, wanted: WantedPolicy): boolean {
  const narrowed = (policy.exclude?.length ?? 0) > 0 || (policy.require?.length ?? 0) > 0;
  if (policy.decision !== wanted.decision || narrowed) return false;

  const included = (policy.include ?? []).map(ruleText);
  if (included.includes(undefined)) return false;

  return included.length === wanted.include.length && [...included].sort().join("\n") === wanted.include.map(ruleText).sort().join("\n");
}

function protectsExactly(application: AccountApplication, uris: readonly string[], policyId: string): boolean {
  const destinations = application.destinations ?? [];
  const samePlaces =
    destinations.every((place) => place.type === "public" && (place.overrides?.length ?? 0) === 0) &&
    destinations.map((place) => place.uri).join("\n") === uris.join("\n");
  const samePolicy = application.policies?.length === 1 && application.policies[0]?.id === policyId;
  const sameSession = Object.entries(SESSION).every(([key, value]) => application[key as keyof typeof SESSION] === value);

  return application.type === "self_hosted" && application.domain === uris[0] && samePlaces && samePolicy && sameSession;
}

function planPolicy(policy: AccountPolicy | undefined, wanted: WantedPolicy): AccessStep {
  if (policy === undefined) return { kind: "create", ...wanted };

  if (decidesExactly(policy, wanted)) return { kind: "leave", subject: wanted.subject };

  return { kind: "change", id: policy.id, ...wanted };
}

function planApplication(application: AccountApplication | undefined, wanted: WantedApplication, policyId: string | undefined): AccessStep {
  if (application === undefined) return { kind: "create", policyId, ...wanted };

  if (policyId !== undefined && protectsExactly(application, wanted.uris, policyId)) return { kind: "leave", subject: wanted.subject };

  return { kind: "change", id: application.id, policyId, ...wanted };
}

/** The policy that lets the install's logins through, as poplin writes it: one rule for each email, in the order of the alphabet. */
function loginsPolicy(logins: Iterable<string>): WantedPolicy {
  return { subject: POLICY_NAME, decision: "allow", include: [...logins].sort().map((email) => ({ email: { email } })) };
}

/** A policy as Cloudflare is sent it. */
function policyBody(accountId: string, wanted: WantedPolicy): { account_id: string; name: string; decision: WantedPolicy["decision"]; include: Rule[] } {
  return { account_id: accountId, name: wanted.subject, decision: wanted.decision, include: [...wanted.include] };
}

/** The steps of one application and the policy it holds: the policy's first, so the application links one that exists. */
function planPair(policy: WantedPolicy, application: WantedApplication, current: AccountAccess): AccessStep[] {
  const held = current.policies.find((candidate) => candidate.name === policy.subject);
  const made = current.applications.find((candidate) => candidate.name === application.subject);

  return [planPolicy(held, policy), planApplication(made, application, held?.id)];
}

/**
 * Compute the Access changes an install needs.
 *
 * @param current - every reusable policy and application of the account as they are now
 * @returns the steps of the open paths, then those of the guarded application, which covers the whole dashboard hostname and then the private sites' pattern.
 * The open paths come first, so no moment of a run leaves the API behind the login
 */
export function planAccess(desired: DesiredAccess, current: AccountAccess): AccessStep[] {
  const open = INSTALL_OBJECTS.openPaths.map((path) => `${desired.hostname}${path}`);

  return [
    ...planPair({ subject: OPEN_POLICY_NAME, decision: "bypass", include: [{ everyone: {} }] }, { subject: OPEN_APPLICATION_NAME, uris: open, policy: OPEN_POLICY_NAME }, current),
    ...planPair(
      loginsPolicy(desired.logins),
      { subject: APPLICATION_NAME, uris: [desired.hostname, desired.privateSites], policy: POLICY_NAME },
      current,
    ),
  ];
}

/**
 * Decide whether a failure says Access is switched off for the account, which only a click in Cloudflare's own dashboard changes.
 *
 * @returns `true` for a refusal that carries Cloudflare's not-enabled message, and for no other failure
 */
export function isAccessOff(failure: CloudflareFailure): boolean {
  return failure.failure === "refused" && failure.errors.some((error) => error.message.includes(ACCESS_NOT_ENABLED));
}

/**
 * Read what the Worker checks a login's token against: the team's domain and the audience tag of poplin's guarded application.
 *
 * @returns the two texts, or `undefined` while the account has no such application or Cloudflare names no team or no tag for it
 */
export async function readLoginFacts(connection: Connection, accountId: string): Promise<CloudflareResult<LoginFacts | undefined>> {
  const applications = await callCloudflare(connection, (api) => Array.fromAsync(new BaseApplications(api).list({ account_id: accountId })));
  if (!applications.ok) return applications;

  const audience = applications.value.find((candidate) => candidate.name === APPLICATION_NAME)?.aud;
  if (audience === undefined) return { ok: true, value: undefined };

  const team = await callCloudflare(connection, (api) => new BaseOrganizations(api).list({ account_id: accountId }));
  if (!team.ok) return team;

  const teamDomain = team.value.auth_domain;

  return { ok: true, value: teamDomain === undefined ? undefined : { teamDomain, audience } };
}

/**
 * Write the install's logins into the policy that lets them through, and nothing else of Access: no application is read or changed.
 *
 * The policy is written even where the list answers that it lets through exactly these emails already: that answer may trail a write made a moment before, and Cloudflare taking the write proves that the key may change who logs in.
 *
 * @param logins - every email let through, in any order
 * @returns `true` once Cloudflare took the policy with exactly these emails, and `false` on an account with no such policy, where nothing is written
 */
export async function writeLogins(connection: Connection, accountId: string, logins: readonly string[]): Promise<CloudflareResult<boolean>> {
  const policies = await callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list({ account_id: accountId })));
  if (!policies.ok) return policies;

  const held = policies.value.find((candidate) => candidate.name === POLICY_NAME);
  const id = held?.id;
  if (held === undefined || id === undefined) return { ok: true, value: false };

  const written = await callCloudflare(connection, (api) => new BasePolicies(api).update(id, policyBody(accountId, loginsPolicy(logins))));

  return written.ok ? { ok: true, value: true } : written;
}

/**
 * End every login at poplin's guarded application: Access takes back each token it gave out for it, so every browser logs in again. The edge follows within some seconds.
 *
 * @returns `true` once Access took the request, and `false` on an account with no such application, where nothing is asked
 */
export async function revokeLogins(connection: Connection, accountId: string): Promise<CloudflareResult<boolean>> {
  const applications = await callCloudflare(connection, (api) => Array.fromAsync(new BaseApplications(api).list({ account_id: accountId })));
  if (!applications.ok) return applications;

  const id = applications.value.find((candidate) => candidate.name === APPLICATION_NAME)?.id;
  if (id === undefined) return { ok: true, value: false };

  const revoked = await callCloudflare(connection, (api) => new BaseApplications(api).revokeTokens(id, { account_id: accountId }));

  return revoked.ok ? { ok: true, value: true } : revoked;
}

/**
 * Make the account's Access match an install's login.
 *
 * @param mode - `plan` reads the policies and applications and sends no change
 * @returns what was created, changed, and left; an application is linked to the policy the same run made
 */
export async function syncAccess(connection: Connection, accountId: string, desired: DesiredAccess, mode: Mode): Promise<Synced> {
  const policies = await callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list({ account_id: accountId })));
  if (!policies.ok) return { ...policies, report: reportOf([]) };

  const applications = await callCloudflare(connection, (api) => Array.fromAsync(new BaseApplications(api).list({ account_id: accountId })));
  if (!applications.ok) return { ...applications, report: reportOf([]) };

  const current = {
    policies: policies.value.map((policy) => ({ ...policy, id: policy.id ?? "" })),
    applications: applications.value.map((application) => ({ ...application, id: application.id ?? "" })),
  };
  const made = new Map<string, string>();

  return applySteps(planAccess(desired, current), async (step): Promise<CloudflareResult<unknown>> => {
    if ("include" in step) {
      const body = policyBody(accountId, step);
      const policy = await callCloudflare(connection, (api) =>
        step.kind === "create" ? new BasePolicies(api).create(body) : new BasePolicies(api).update(step.id, body),
      );
      if (policy.ok) made.set(step.subject, policy.value.id ?? "");

      return policy;
    }

    const body = {
      account_id: accountId,
      name: step.subject,
      type: "self_hosted" as const,
      domain: step.uris[0] ?? "",
      destinations: step.uris.map((uri) => ({ type: "public" as const, uri })),
      policies: [{ id: step.policyId ?? made.get(step.policy) ?? "", precedence: 1 }],
      ...SESSION,
    };

    return callCloudflare(connection, (api) =>
      step.kind === "create" ? new BaseApplications(api).create(body) : new BaseApplications(api).update(step.id, body),
    );
  }, mode);
}
