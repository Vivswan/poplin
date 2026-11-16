import { describe, expect, test } from "bun:test";
import { planJobs, syncJobs } from "../../../src/zone/jobs/jobs";
import { withFake } from "../support/fake-cloudflare";
import { page, refusal, reply } from "../support/replies";

/** The Workflow of the Worker named `poplin`, as the account's list reads it back. */
const OWN = { name: "poplin-jobs", script_name: "poplin", class_name: "PoplinJobs" };

/** The install's Worker. */
const WORKER = { accountId: "account-a", script: "poplin" };

describe("planJobs", () => {
  const cases: readonly { readonly name: string; readonly workflows: readonly object[]; readonly kind: string }[] = [
    { name: "an account with no Workflow", workflows: [], kind: "create" },
    { name: "an account with its owner's Workflow alone, whose name the search also finds", workflows: [{ ...OWN, name: "poplin-jobs-old", script_name: "theirs" }], kind: "create" },
    { name: "the Workflow as a deploy made it, beside the owner's", workflows: [{ ...OWN, name: "poplin-jobs-old", script_name: "theirs" }, OWN], kind: "leave" },
    { name: "the Workflow pointed at a class the Worker does not export", workflows: [{ ...OWN, class_name: "Other" }], kind: "change" },
    { name: "the Workflow of a Worker that was deleted and deployed anew", workflows: [{ ...OWN, script_deleted: true }], kind: "change" },
    { name: "a Workflow of the name left behind by another Worker that was deleted", workflows: [{ ...OWN, script_name: "gone", script_deleted: true }], kind: "change" },
    { name: "a Workflow of the name that runs another Worker's code", workflows: [{ ...OWN, script_name: "theirs" }], kind: "skip" },
  ];

  // Drift: a repair that took a Workflow over from a Worker that still runs it would stop that Worker's own work, and one that left a dead Workflow in place would leave every large copy failing at its start.
  test.each(cases)("$name: the one step names the Worker's own Workflow and is a $kind", ({ workflows, kind }) => {
    expect(planJobs(workflows, "poplin").map((step) => [step.kind, step.subject])).toEqual([[kind, "poplin-jobs"]]);
  });
});

describe("syncJobs", () => {
  // Drift: the call that makes a Workflow is the one a deploy sends. A body with another field name passes every type check here and is refused by every real account.
  test("three runs against one account: a check sends no change, the first repair makes the Workflow of the Worker's class, and the second sends nothing", async () => {
    const workflows: object[] = [];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, workflows);

        workflows.push({ name: asked.path.slice(asked.path.lastIndexOf("/") + 1), ...(asked.body as object) });

        return reply({ name: "poplin-jobs" });
      },
      async (connection, asked) => {
        expect(await syncJobs(connection, WORKER, "plan")).toMatchObject({ ok: true, report: { created: ["poplin-jobs"] } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual(["GET /accounts/account-a/workflows?search=poplin-jobs"]);
        expect(await syncJobs(connection, WORKER, "apply")).toMatchObject({ ok: true, report: { created: ["poplin-jobs"], changedNothing: false } });
        expect(await syncJobs(connection, WORKER, "apply")).toMatchObject({ ok: true, report: { left: ["poplin-jobs"], changedNothing: true } });
        expect(asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body])).toEqual([["PUT", "/accounts/account-a/workflows/poplin-jobs", { script_name: "poplin", class_name: "PoplinJobs" }]]);
      },
    );
  });

  test("a key without the Workers Scripts permission: the run fails with Cloudflare's refusal before it changed anything, so a repair goes on and its row names the right", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncJobs(connection, WORKER, "apply")).toMatchObject({ ok: false, failure: "refused", status: 403, report: { changedNothing: true } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
