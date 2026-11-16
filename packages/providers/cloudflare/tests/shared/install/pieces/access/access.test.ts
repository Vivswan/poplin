import { describe, expect, test } from "bun:test";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { planAccess, syncAccess } from "../../../../../src/shared/install/pieces/access/access";
import { reportOf } from "../../../../../src/shared/install/sync";
import { withFake } from "../../support/fake-cloudflare";
import { page, reply } from "../../support/replies";
import { ADDRESSES, hostOf } from "../../support/layouts";

const ADMIN = hostOf("poplin.example.com");
const PRIVATE_SITES = "*-p-poplin.example.com";
const SESSION = { session_duration: "720h", http_only_cookie_attribute: true, same_site_cookie_attribute: "lax" };
const NOTHING = { policies: [], applications: [] };

const GUARDED = ["poplin.example.com", PRIVATE_SITES];
const OPEN = ["poplin.example.com/api"];
const LEFT = [
  { kind: "leave", subject: "poplin open paths policy" },
  { kind: "leave", subject: "poplin open paths" },
  { kind: "leave", subject: "poplin logins" },
  { kind: "leave", subject: "poplin" },
] as const;

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

function everyone(more: Partial<Policy> = {}): Policy {
  return { id: "pol-open", name: "poplin open paths policy", decision: "bypass", include: [{ everyone: {} }], exclude: [], require: [], ...more };
}

function applicationOver(uris: readonly string[], policyId: string, more: Partial<Application>): Application {
  return { id: "", type: "self_hosted", domain: uris[0], destinations: uris.map((each) => ({ type: "public", uri: each })), policies: [{ id: policyId }], ...SESSION, ...more };
}

/** The guarded application as the install wants it: over the whole admin hostname and over the private sites. */
function application(id: string, hostname: string, policyId: string, more: Partial<Application> = {}): Application {
  return applicationOver([hostname, PRIVATE_SITES], policyId, { id, name: "poplin", ...more });
}

/** The open application as the install wants it: over the API of the admin hostname. */
function openPaths(more: Partial<Application> = {}): Application {
  return applicationOver(OPEN, "pol-open", { id: "app-open", name: "poplin open paths", ...more });
}

describe("planAccess", () => {
  const owner = loginsOf("owner@example.com", "second@example.com");
  const emails = ["owner@example.com", "second@example.com"];
  const include = emails.map((email) => ({ email: { email } }));
  const desired = { hostname: ADMIN, logins: owner, privateSites: PRIVATE_SITES };

  // Drift: a private site's address left out of the guarded application reaches the Worker with no token, and every private site answers 404 to its owner.
  // The open paths are planned first: a run that stops half way must never leave the API behind a login no program can pass.
  test("an account with no Access gets the open paths with their policy, then the logins' policy and the application over the whole admin hostname and the private sites", () => {
    expect(planAccess(desired, NOTHING)).toEqual([
      { kind: "create", subject: "poplin open paths policy", decision: "bypass", include: [{ everyone: {} }] },
      { kind: "create", subject: "poplin open paths", uris: OPEN, policy: "poplin open paths policy", policyId: undefined },
      { kind: "create", subject: "poplin logins", decision: "allow", include },
      { kind: "create", subject: "poplin", uris: GUARDED, policy: "poplin logins", policyId: undefined },
    ]);
  });

  test("planned again over its own policies and applications, beside the owner's own, it changes nothing and says so", () => {
    const current = {
      policies: [
        { id: "pol-0", name: "the owner's own policy", decision: "allow", include: [{ everyone: {} }] },
        policy("pol-1", ["second@example.com", "owner@example.com"]),
        everyone(),
      ],
      applications: [
        { id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" },
        application("app-1", ADMIN, "pol-1"),
        openPaths(),
      ],
    };
    const steps = planAccess(desired, current);

    expect(steps).toEqual([...LEFT]);
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  // Drift: an install without a domain whose private host is left out of the application has no login in front of it, so the Worker answers every private site 404, to its owner too.
  test("an install without a domain: the same four steps over its free addresses, the open paths of the admin host let through and the application over the whole admin host and the whole private host", () => {
    const addresses = { hostname: ADDRESSES.adminHost, logins: owner, privateSites: ADDRESSES.privateHost };
    const guarded = ["poplin.example.workers.dev", "poplin-private.example.workers.dev"];
    const open = ["poplin.example.workers.dev/api"];
    const made = [everyone(), policy("pol-1", emails)];
    const applications = [applicationOver(open, "pol-open", { id: "app-open", name: "poplin open paths" }), applicationOver(guarded, "pol-1", { id: "app-1", name: "poplin" })];

    expect(planAccess(addresses, NOTHING)).toEqual([
      { kind: "create", subject: "poplin open paths policy", decision: "bypass", include: [{ everyone: {} }] },
      { kind: "create", subject: "poplin open paths", uris: open, policy: "poplin open paths policy", policyId: undefined },
      { kind: "create", subject: "poplin logins", decision: "allow", include },
      { kind: "create", subject: "poplin", uris: guarded, policy: "poplin logins", policyId: undefined },
    ]);
    expect(planAccess(addresses, { policies: made, applications })).toEqual([...LEFT]);
  });

  // Drift: an install made while the login stood in front of `/login` alone would keep its dashboard open to the Worker's own check only.
  test("an install whose application still covers the login path alone: one plan makes the open paths and moves the application to the whole admin hostname, under its id", () => {
    const before = applicationOver(["poplin.example.com/login", PRIVATE_SITES], "pol-1", { id: "app-1", name: "poplin" });

    expect(planAccess(desired, { policies: [policy("pol-1", emails)], applications: [before] })).toEqual([
      { kind: "create", subject: "poplin open paths policy", decision: "bypass", include: [{ everyone: {} }] },
      { kind: "create", subject: "poplin open paths", uris: OPEN, policy: "poplin open paths policy", policyId: undefined },
      { kind: "leave", subject: "poplin logins" },
      { kind: "change", subject: "poplin", id: "app-1", uris: GUARDED, policy: "poplin logins", policyId: "pol-1" },
    ]);
  });

  const widened: readonly { readonly name: string; readonly policy: Policy }[] = [
    { name: "an email was added by hand", policy: policy("pol-1", [...emails, "guest@example.com"]) },
    { name: "an email is missing", policy: policy("pol-1", ["owner@example.com"]) },
    { name: "a whole domain was let in", policy: policy("pol-1", emails, { include: [...include, { email_domain: { domain: "example.com" } }] }) },
    { name: "everyone was let in", policy: policy("pol-1", emails, { include: [{ everyone: {} }] }) },
    { name: "everyone was let in beside the logins", policy: policy("pol-1", emails, { include: [...include, { everyone: {} }] }) },
    { name: "the decision was changed", policy: policy("pol-1", emails, { decision: "bypass" }) },
    { name: "an exclusion was added", policy: policy("pol-1", emails, { exclude: [{ email: { email: "owner@example.com" } }] }) },
    { name: "a requirement was added", policy: policy("pol-1", emails, { require: [{ email_domain: { domain: "example.com" } }] }) },
  ];

  test.each(widened)("$name: the logins' policy is changed back to exactly the login list, everything else left", ({ policy: drifted }) => {
    const current = { policies: [drifted, everyone()], applications: [application("app-1", ADMIN, "pol-1"), openPaths()] };

    expect(planAccess(desired, current)).toEqual([LEFT[0], LEFT[1], { kind: "change", subject: "poplin logins", id: "pol-1", decision: "allow", include }, LEFT[3]]);
  });

  // Drift: an open policy narrowed by hand puts the API behind a login, and one widened in kind is no longer the one rule the install wrote.
  const narrowed: readonly { readonly name: string; readonly policy: Policy }[] = [
    { name: "the open policy was made to ask for a login", policy: everyone({ decision: "allow" }) },
    { name: "the open policy was given an email in place of everyone", policy: everyone({ include: [{ email: { email: "owner@example.com" } }] }) },
    { name: "the open policy was given a requirement", policy: everyone({ require: [{ email_domain: { domain: "example.com" } }] }) },
    { name: "the open policy was given an exclusion", policy: everyone({ exclude: [{ email: { email: "owner@example.com" } }] }) },
  ];

  test.each(narrowed)("$name: it is changed back to bypass for everyone, everything else left", ({ policy: drifted }) => {
    const current = { policies: [policy("pol-1", emails), drifted], applications: [application("app-1", ADMIN, "pol-1"), openPaths()] };

    expect(planAccess(desired, current)).toEqual([{ kind: "change", subject: "poplin open paths policy", id: "pol-open", decision: "bypass", include: [{ everyone: {} }] }, LEFT[1], LEFT[2], LEFT[3]]);
  });

  const moved: readonly { readonly name: string; readonly application: Application }[] = [
    { name: "the admin hostname changed", application: application("app-1", "old.example.com", "pol-1") },
    { name: "a second policy was attached", application: application("app-1", ADMIN, "pol-1", { policies: [{ id: "pol-1" }, { id: "pol-0" }] }) },
    { name: "another policy replaced it", application: application("app-1", ADMIN, "pol-0") },
    { name: "the open policy replaced the logins'", application: application("app-1", ADMIN, "pol-open") },
    {
      name: "an override made a path public",
      application: application("app-1", ADMIN, "pol-1", {
        destinations: [
          { type: "public", uri: "poplin.example.com", overrides: [{ behavior: "public", path_pattern: "/data" }] },
          { type: "public", uri: PRIVATE_SITES },
        ],
      }),
    },
    { name: "the private sites were taken out", application: application("app-1", ADMIN, "pol-1", { destinations: [{ type: "public", uri: "poplin.example.com" }] }) },
    { name: "the private sites were widened to every hostname", application: application("app-1", ADMIN, "pol-1", { destinations: [{ type: "public", uri: "poplin.example.com" }, { type: "public", uri: "*.example.com" }] }) },
    { name: "the session was made a day", application: application("app-1", ADMIN, "pol-1", { session_duration: "24h" }) },
    { name: "the cookie was opened to scripts", application: application("app-1", ADMIN, "pol-1", { http_only_cookie_attribute: false }) },
    { name: "the cookie was opened to other sites' requests", application: application("app-1", ADMIN, "pol-1", { same_site_cookie_attribute: "none" }) },
    { name: "the cookie attributes were never set, as on an application made before them", application: application("app-1", ADMIN, "pol-1", { http_only_cookie_attribute: undefined, same_site_cookie_attribute: undefined }) },
    {
      name: "a destination was added",
      application: application("app-1", ADMIN, "pol-1", { destinations: [...GUARDED, "wiki.example.com"].map((uri) => ({ type: "public", uri })) }),
    },
  ];

  test.each(moved)("$name: the guarded application is changed back by its id, everything else left", ({ application: drifted }) => {
    const current = { policies: [policy("pol-1", emails), everyone()], applications: [drifted, openPaths()] };

    expect(planAccess(desired, current)).toEqual([LEFT[0], LEFT[1], LEFT[2], { kind: "change", subject: "poplin", id: "app-1", uris: GUARDED, policy: "poplin logins", policyId: "pol-1" }]);
  });

  // Drift: a path added to the open application by hand is a part of the dashboard anyone reaches with no login at Cloudflare; one taken out puts the API behind it.
  const opened: readonly { readonly name: string; readonly application: Application }[] = [
    { name: "a path of the dashboard was added to the open paths", application: openPaths({ destinations: [...OPEN, "poplin.example.com/data"].map((uri) => ({ type: "public", uri })) }) },
    { name: "the whole admin hostname was made an open path", application: openPaths({ domain: "poplin.example.com", destinations: [{ type: "public", uri: "poplin.example.com" }] }) },
    { name: "a path the install opened once and opens no more is still among the open paths", application: openPaths({ destinations: [...OPEN, "poplin.example.com/setup"].map((uri) => ({ type: "public", uri })) }) },
    { name: "the logins' policy replaced the open one", application: openPaths({ policies: [{ id: "pol-1" }] }) },
  ];

  test.each(opened)("$name: the open application is changed back by its id, everything else left", ({ application: drifted }) => {
    const current = { policies: [policy("pol-1", emails), everyone()], applications: [application("app-1", ADMIN, "pol-1"), drifted] };

    expect(planAccess(desired, current)).toEqual([LEFT[0], { kind: "change", subject: "poplin open paths", id: "app-open", uris: OPEN, policy: "poplin open paths policy", policyId: "pol-open" }, LEFT[2], LEFT[3]]);
  });
});

describe("syncAccess", () => {
  // Drift: a repair would make one application per run. Two policies in one application would also need two precedences, which Cloudflare refuses alike.
  test("two runs against one account: the first creates each policy and then its application, linked to that policy's new id at precedence 1; the second sends no change", async () => {
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
        const made = (name: string, uris: readonly string[], policyId: string): unknown => ({
          name,
          type: "self_hosted",
          domain: uris[0],
          destinations: uris.map((uri) => ({ type: "public", uri })),
          policies: [{ id: policyId, precedence: 1 }],
          ...SESSION,
        });

        expect(first).toMatchObject({ ok: true, report: { created: ["poplin open paths policy", "poplin open paths", "poplin logins", "poplin"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["poplin open paths policy", "poplin open paths", "poplin logins", "poplin"], changedNothing: true } });
        expect(asked.slice(sent).every((entry) => entry.method === "GET")).toBe(true);
        expect(asked.filter((entry) => entry.method === "POST").map((entry) => [entry.path, entry.body])).toEqual([
          ["/accounts/account-a/access/policies", { name: "poplin open paths policy", decision: "bypass", include: [{ everyone: {} }] }],
          ["/accounts/account-a/access/apps", made("poplin open paths", OPEN, "made-0")],
          ["/accounts/account-a/access/policies", { name: "poplin logins", decision: "allow", include: [{ email: { email: "owner@example.com" } }] }],
          ["/accounts/account-a/access/apps", made("poplin", GUARDED, "made-1")],
        ]);
        expect(applications[0]).toEqual({ id: "app-0", name: "the owner's own application", type: "self_hosted", domain: "wiki.example.com" });
      },
    );
  });
});
