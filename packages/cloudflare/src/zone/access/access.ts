// The one Access application in front of the login path and of every private site's address, and the one policy that lets the install's logins through.
// Access keeps no mark on either, so poplin's are the ones with its fixed names, which the OpenTofu module gives them too.

import type { Logins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../sync";

/** The name that marks the policy as poplin's. */
const POLICY_NAME = INSTALL_OBJECTS.accessPolicy;

/** The name that marks the application as poplin's. */
const APPLICATION_NAME = INSTALL_OBJECTS.accessApplication;

/** What Cloudflare's refusal says on an account whose Access was never switched on. */
const NOT_ENABLED = "access.api.error.not_enabled";

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
  /** The admin hostname, where the login path answers. */
  readonly hostname: Hostname;

  /** The emails let through. */
  readonly logins: Logins;

  /** The hostname pattern of every private site's address, from `privateSitesPattern`. */
  readonly privateSites: string;
}

/** One step of an Access plan. An application step with no `policyId` links the policy the same plan creates. */
type AccessStep =
  | { readonly kind: "create"; readonly subject: typeof POLICY_NAME; readonly emails: readonly string[] }
  | { readonly kind: "change"; readonly subject: typeof POLICY_NAME; readonly id: string; readonly emails: readonly string[] }
  | { readonly kind: "create"; readonly subject: typeof APPLICATION_NAME; readonly uris: readonly string[]; readonly policyId: string | undefined }
  | {
      readonly kind: "change";
      readonly subject: typeof APPLICATION_NAME;
      readonly id: string;
      readonly uris: readonly string[];
      readonly policyId: string | undefined;
    }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function emailOf(rule: unknown): string | undefined {
  if (typeof rule !== "object" || rule === null || Object.keys(rule).join() !== "email") return undefined;

  const email = "email" in rule ? rule.email : undefined;
  if (typeof email !== "object" || email === null || !("email" in email) || typeof email.email !== "string") return undefined;

  return email.email;
}

function allowsExactly(policy: AccountPolicy, emails: readonly string[]): boolean {
  const narrowed = (policy.exclude?.length ?? 0) > 0 || (policy.require?.length ?? 0) > 0;
  if (policy.decision !== "allow" || narrowed) return false;

  const included = (policy.include ?? []).map(emailOf);
  if (included.includes(undefined)) return false;

  return included.length === emails.length && [...included].sort().join("\n") === emails.join("\n");
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

function planPolicy(policy: AccountPolicy | undefined, emails: readonly string[]): AccessStep {
  if (policy === undefined) return { kind: "create", subject: POLICY_NAME, emails };

  if (allowsExactly(policy, emails)) return { kind: "leave", subject: POLICY_NAME };

  return { kind: "change", subject: POLICY_NAME, id: policy.id, emails };
}

function planApplication(application: AccountApplication | undefined, uris: readonly string[], policyId: string | undefined): AccessStep {
  if (application === undefined) return { kind: "create", subject: APPLICATION_NAME, uris, policyId };

  if (policyId !== undefined && protectsExactly(application, uris, policyId)) return { kind: "leave", subject: APPLICATION_NAME };

  return { kind: "change", subject: APPLICATION_NAME, id: application.id, uris, policyId };
}

/**
 * Compute the Access changes an install needs.
 *
 * @param current - every reusable policy and application of the account as they are now
 * @returns the policy's step, then the application's, which covers the login path of the shared table and then the private sites' pattern
 */
export function planAccess(desired: DesiredAccess, current: AccountAccess): AccessStep[] {
  const emails = [...desired.logins].sort();
  const uris = [`${desired.hostname}${INSTALL_OBJECTS.loginPath}`, desired.privateSites];
  const policy = current.policies.find((candidate) => candidate.name === POLICY_NAME);
  const application = current.applications.find((candidate) => candidate.name === APPLICATION_NAME);

  return [planPolicy(policy, emails), planApplication(application, uris, policy?.id)];
}

/**
 * Decide whether a failure says Access is switched off for the account, which only a click in Cloudflare's own dashboard changes.
 *
 * @returns `true` for a refusal that carries Cloudflare's not-enabled message, and for no other failure
 */
export function isAccessOff(failure: CloudflareFailure): boolean {
  return failure.failure === "refused" && failure.errors.some((error) => error.message.includes(NOT_ENABLED));
}

/**
 * Make the account's Access match an install's login.
 *
 * @param mode - `plan` reads the policies and applications and sends no change
 * @returns what was created, changed, and left; the application is linked to the policy the same run made
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
  let createdPolicyId = "";

  return applySteps(planAccess(desired, current), async (step): Promise<CloudflareResult<unknown>> => {
    if ("emails" in step) {
      const body = { account_id: accountId, name: POLICY_NAME, decision: "allow" as const, include: step.emails.map((email) => ({ email: { email } })) };
      const policy = await callCloudflare(connection, (api) =>
        step.kind === "create" ? new BasePolicies(api).create(body) : new BasePolicies(api).update(step.id, body),
      );
      if (policy.ok) createdPolicyId = policy.value.id ?? "";

      return policy;
    }

    const body = {
      account_id: accountId,
      name: APPLICATION_NAME,
      type: "self_hosted" as const,
      domain: step.uris[0] ?? "",
      destinations: step.uris.map((uri) => ({ type: "public" as const, uri })),
      policies: [{ id: step.policyId ?? createdPolicyId, precedence: 1 }],
      ...SESSION,
    };

    return callCloudflare(connection, (api) =>
      step.kind === "create" ? new BaseApplications(api).create(body) : new BaseApplications(api).update(step.id, body),
    );
  }, mode);
}
