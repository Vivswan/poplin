import { describe, expect, test } from "bun:test";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { planAccess, syncAccess } from "../../../src/zone/access/access";
import { reportOf } from "../../../src/zone/sync";
import { page, reply, withFake } from "../support/fake-cloudflare";
import { hostOf } from "../support/layouts";

const ADMIN = hostOf("poplin.example.com");
const PRIVATE_SITES = "*-p-poplin.example.com";
const SESSION = { session_duration: "720h", http_only_cookie_attribute: true, same_site_cookie_attribute: "lax" };
const NOTHING = { policies: [], applications: [] };

function loginsOf(...emails: string[]): Parameters<typeof planAccess>[0]["logins"] {
  const logins = parseLogins(emails);
  if (!logins.ok) throw new Error(`the test's logins were refused: ${logins.refusal}`);

  return logins.value;
}

type Current = Parameters<typeof planAccess>[1];
type Policy = Current["policies"][number];
type Application = Current["applications"][number];

function policy(id: string, emails: readonly string[], more: Partial<Policy> = {}): Policy {
  return { id, name: "poplin logins", decision: "allow", include: emails.map((email) => ({ email: { email } })), exclude: [], require: [], ...more };
}

/** The application as the install wants it: over the login path and over the private sites. */
function application(id: string, hostname: string, policyId: string, more: Partial<Application> = {}): Application {
  const uri = `${hostname}/login`;
  const uris = [uri, PRIVATE_SITES];

  return {
    id,
    name: "poplin",
    type: "self_hosted",
    domain: uri,
    destinations: uris.map((each) => ({ type: "public", uri: each })),
    policies: [{ id: policyId }],
    ...SESSION,
    ...more,
  };
}

describe("planAccess", () => {
  const owner = loginsOf("owner@example.com", "second@example.com");
  const emails = ["owner@example.com", "second@example.com"];

  // Drift: a private site's address left out of the application reaches the Worker with no token, and every private site answers 404 to its owner.
  test("an account with no Access gets the policy, then the one application over the login path and the private sites, linked to it", () => {
    expect(planAccess({ hostname: ADMIN, logins: owner, privateSites: PRIVATE_SITES }, NOTHING)).toEqual([
      { kind: "create", subject: "poplin logins", emails },
      { kind: "create", subject: "poplin", uris: ["poplin.example.com/login", PRIVATE_SITES], policyId: undefined },
    ]);
  });

  test("planned again over its own policy and application, beside the owner's own, it changes nothing and says so", () => {
    const current = {
      policies: [
        { id: "pol-0", name: "the owner's own policy", decision: "allow", include: [{ everyone: {} }] },
        policy("pol-1", ["second@example.com", "owner@example.com"]),
      ],
      applications: [
        { id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" },
        application("app-1", ADMIN, "pol-1"),
      ],
    };
    const steps = planAccess({ hostname: ADMIN, logins: owner, privateSites: PRIVATE_SITES }, current);

    expect(steps).toEqual([
      { kind: "leave", subject: "poplin logins" },
      { kind: "leave", subject: "poplin" },
    ]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  const widened: readonly { readonly name: string; readonly policy: Policy }[] = [
    { name: "an email was added by hand", policy: policy("pol-1", [...emails, "guest@example.com"]) },
    { name: "an email is missing", policy: policy("pol-1", ["owner@example.com"]) },
    {
      name: "a whole domain was let in",
      policy: policy("pol-1", emails, { include: [...emails.map((email) => ({ email: { email } })), { email_domain: { domain: "example.com" } }] }),
    },
    { name: "everyone was let in", policy: policy("pol-1", emails, { include: [{ everyone: {} }] }) },
    { name: "the decision was changed", policy: policy("pol-1", emails, { decision: "bypass" }) },
    { name: "an exclusion was added", policy: policy("pol-1", emails, { exclude: [{ email: { email: "owner@example.com" } }] }) },
    { name: "a requirement was added", policy: policy("pol-1", emails, { require: [{ email_domain: { domain: "example.com" } }] }) },
  ];

  test.each(widened)("$name: the policy is changed back to exactly the login list, the application left", ({ policy: drifted }) => {
    const current = { policies: [drifted], applications: [application("app-1", ADMIN, "pol-1")] };

    expect(planAccess({ hostname: ADMIN, logins: owner, privateSites: PRIVATE_SITES }, current)).toEqual([
      { kind: "change", subject: "poplin logins", id: "pol-1", emails },
      { kind: "leave", subject: "poplin" },
    ]);
  });

  const moved: readonly { readonly name: string; readonly application: Application }[] = [
    { name: "the admin hostname changed", application: application("app-1", "old.example.com", "pol-1") },
    { name: "a second policy was attached", application: application("app-1", ADMIN, "pol-1", { policies: [{ id: "pol-1" }, { id: "pol-0" }] }) },
    { name: "another policy replaced it", application: application("app-1", ADMIN, "pol-0") },
    {
      name: "an override made the login path public",
      application: application("app-1", ADMIN, "pol-1", {
        destinations: [
          { type: "public", uri: "poplin.example.com/login", overrides: [{ behavior: "public", path_pattern: "/login" }] },
          { type: "public", uri: PRIVATE_SITES },
        ],
      }),
    },
    { name: "the private sites were taken out", application: application("app-1", ADMIN, "pol-1", { destinations: [{ type: "public", uri: "poplin.example.com/login" }] }) },
    { name: "the private sites were widened to every hostname", application: application("app-1", ADMIN, "pol-1", { destinations: [{ type: "public", uri: "poplin.example.com/login" }, { type: "public", uri: "*.example.com" }] }) },
    { name: "the session was made a day", application: application("app-1", ADMIN, "pol-1", { session_duration: "24h" }) },
    { name: "the cookie was opened to scripts", application: application("app-1", ADMIN, "pol-1", { http_only_cookie_attribute: false }) },
    { name: "the cookie was opened to other sites' requests", application: application("app-1", ADMIN, "pol-1", { same_site_cookie_attribute: "none" }) },
    { name: "the cookie attributes were never set, as on an application made before them", application: application("app-1", ADMIN, "pol-1", { http_only_cookie_attribute: undefined, same_site_cookie_attribute: undefined }) },
    {
      name: "a destination was added",
      application: application("app-1", ADMIN, "pol-1", {
        destinations: [
          { type: "public", uri: "poplin.example.com/login" },
          { type: "public", uri: PRIVATE_SITES },
          { type: "public", uri: "wiki.example.com" },
        ],
      }),
    },
  ];

  test.each(moved)("$name: the application is changed back by its id, the policy left", ({ application: drifted }) => {
    const current = { policies: [policy("pol-1", emails)], applications: [drifted] };

    expect(planAccess({ hostname: ADMIN, logins: owner, privateSites: PRIVATE_SITES }, current)).toEqual([
      { kind: "leave", subject: "poplin logins" },
      { kind: "change", subject: "poplin", id: "app-1", uris: ["poplin.example.com/login", PRIVATE_SITES], policyId: "pol-1" },
    ]);
  });
});

describe("syncAccess", () => {
  // Drift: setup would make an application the OpenTofu module's next apply rewrites, or one per run.
  test("two runs against one account: the first creates the policy and the one application with both destinations and the session, linked to the policy's new id; the second sends no change", async () => {
    const policies: Record<string, unknown>[] = [];
    const applications: Record<string, unknown>[] = [{ id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" }];

    await withFake(
      (asked) => {
        const list = asked.path.includes("/access/policies") ? policies : applications;

        if (asked.method === "GET") return page(asked, list);

        const made = { id: `made-${list.length}`, ...(asked.body as object) };
        list.push(made);

        return reply(made);
      },
      async (connection, asked) => {
        const desired = { hostname: ADMIN, logins: loginsOf("owner@example.com"), privateSites: PRIVATE_SITES };
        const first = await syncAccess(connection, "account-a", desired, "apply");
        const sent = asked.length;
        const second = await syncAccess(connection, "account-a", desired, "apply");

        expect(first).toMatchObject({ ok: true, report: { created: ["poplin logins", "poplin"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["poplin logins", "poplin"], changedNothing: true } });
        expect(asked.slice(sent).every((entry) => entry.method === "GET")).toBe(true);
        expect(asked.filter((entry) => entry.method === "POST").map((entry) => [entry.path, entry.body])).toEqual([
          ["/accounts/account-a/access/policies", { name: "poplin logins", decision: "allow", include: [{ email: { email: "owner@example.com" } }] }],
          [
            "/accounts/account-a/access/apps",
            {
              name: "poplin",
              type: "self_hosted",
              domain: "poplin.example.com/login",
              destinations: [
                { type: "public", uri: "poplin.example.com/login" },
                { type: "public", uri: PRIVATE_SITES },
              ],
              policies: [{ id: "made-0", precedence: 1 }],
              ...SESSION,
            },
          ],
        ]);
        expect(applications[0]).toEqual({ id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" });
      },
    );
  });
});
