import { describe, expect, test } from "bun:test";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { planAccess, syncAccess } from "../../../src/zone/access/access";
import { reportOf } from "../../../src/zone/sync";
import { page, reply, withFake } from "../support/fake-cloudflare";
import { hostOf } from "../support/layouts";

const ADMIN = hostOf("admin.example.com");
const WORKER = hostOf("poplin.an-account.workers.dev");
const PATHS = ["/login", "/oauth/authorize"];
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

function application(id: string, hostname: string, policyId: string, more: Partial<Application> = {}): Application {
  const uris = PATHS.map((path) => `${hostname}${path}`);

  return {
    id,
    name: "poplin",
    type: "self_hosted",
    domain: uris[0],
    destinations: uris.map((uri) => ({ type: "public", uri })),
    policies: [{ id: policyId }],
    ...more,
  };
}

describe("planAccess", () => {
  const owner = loginsOf("owner@example.com", "second@example.com");
  const emails = ["owner@example.com", "second@example.com"];

  const installs: readonly { readonly name: string; readonly hostname: typeof ADMIN }[] = [
    { name: "an install with a domain, on the admin hostname", hostname: ADMIN },
    { name: "an install with no domain, on the Worker's workers.dev hostname", hostname: WORKER },
  ];

  test.each(installs)("$name: an account with no Access gets the policy, then the application over the login paths linked to it", ({ hostname }) => {
    expect(planAccess({ hostname, paths: PATHS, logins: owner }, NOTHING)).toEqual([
      { kind: "create", subject: "poplin logins", emails },
      { kind: "create", subject: "poplin", uris: [`${hostname}/login`, `${hostname}/oauth/authorize`], policyId: undefined },
    ]);
  });

  test.each(installs)("$name planned again over its own policy and application changes nothing and says so", ({ hostname }) => {
    const current = {
      policies: [
        { id: "pol-0", name: "the owner's own policy", decision: "allow", include: [{ everyone: {} }] },
        policy("pol-1", ["second@example.com", "owner@example.com"]),
      ],
      applications: [
        { id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" },
        application("app-1", hostname, "pol-1"),
      ],
    };
    const steps = planAccess({ hostname, paths: PATHS, logins: owner }, current);

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

    expect(planAccess({ hostname: ADMIN, paths: PATHS, logins: owner }, current)).toEqual([
      { kind: "change", subject: "poplin logins", id: "pol-1", emails },
      { kind: "leave", subject: "poplin" },
    ]);
  });

  const moved: readonly { readonly name: string; readonly application: Application }[] = [
    { name: "the admin hostname changed", application: application("app-1", "old.example.com", "pol-1") },
    { name: "a second policy was attached", application: application("app-1", ADMIN, "pol-1", { policies: [{ id: "pol-1" }, { id: "pol-0" }] }) },
    { name: "another policy replaced it", application: application("app-1", ADMIN, "pol-0") },
    {
      name: "an override made a login path public",
      application: application("app-1", ADMIN, "pol-1", {
        destinations: [
          { type: "public", uri: "admin.example.com/login", overrides: [{ behavior: "public", path_pattern: "/login" }] },
          { type: "public", uri: "admin.example.com/oauth/authorize" },
        ],
      }),
    },
    {
      name: "a destination was added",
      application: application("app-1", ADMIN, "pol-1", {
        destinations: [
          { type: "public", uri: "admin.example.com/login" },
          { type: "public", uri: "admin.example.com/oauth/authorize" },
          { type: "public", uri: "wiki.example.com" },
        ],
      }),
    },
  ];

  test.each(moved)("$name: the application is changed back by its id, the policy left", ({ application: drifted }) => {
    const current = { policies: [policy("pol-1", emails)], applications: [drifted] };

    expect(planAccess({ hostname: ADMIN, paths: PATHS, logins: owner }, current)).toEqual([
      { kind: "leave", subject: "poplin logins" },
      { kind: "change", subject: "poplin", id: "app-1", uris: ["admin.example.com/login", "admin.example.com/oauth/authorize"], policyId: "pol-1" },
    ]);
  });

  const refused: readonly { readonly name: string; readonly paths: readonly string[]; readonly subjects: readonly string[] }[] = [
    { name: "no path", paths: [], subjects: ["poplin"] },
    { name: "a path with no leading slash", paths: ["/login", "login"], subjects: ["login"] },
    { name: "a path with a wildcard", paths: ["/*"], subjects: ["/*"] },
    { name: "a path with a query", paths: ["/login?next=/"], subjects: ["/login?next=/"] },
    { name: "a path that names another host", paths: ["/login", ".example.org/login"], subjects: [".example.org/login"] },
  ];

  test.each(refused)("$name stops the plan with a skip and no change: a path is appended to the hostname as it is", ({ paths, subjects }) => {
    const steps = planAccess({ hostname: ADMIN, paths, logins: owner }, NOTHING);

    expect(steps.map((step) => [step.kind, step.subject])).toEqual(subjects.map((subject) => ["skip", subject]));
  });
});

describe("syncAccess", () => {
  test("two runs against one account: the first creates the policy and links the application to its new id, the second sends no change", async () => {
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
        const desired = { hostname: ADMIN, paths: PATHS, logins: loginsOf("owner@example.com") };
        const first = await syncAccess(connection, "account-a", desired);
        const sent = asked.length;
        const second = await syncAccess(connection, "account-a", desired);

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
              domain: "admin.example.com/login",
              destinations: [
                { type: "public", uri: "admin.example.com/login" },
                { type: "public", uri: "admin.example.com/oauth/authorize" },
              ],
              policies: [{ id: "made-0", precedence: 1 }],
            },
          ],
        ]);
        expect(applications[0]).toEqual({ id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" });
      },
    );
  });
});
