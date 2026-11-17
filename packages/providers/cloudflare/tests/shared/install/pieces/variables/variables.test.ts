import { expect, test } from "bun:test";
import { planVariables, readBindings, readWorker, syncVariables } from "../../../../../src/shared/install/pieces/variables/variables";
import { withFake } from "../../support/fake-cloudflare";
import { answer, emptyAccount, TOKEN } from "../../support/fake-install";

const WANTED = { team_domain: "team.cloudflareaccess.com", audience: "a".repeat(64) };
const DESIRED = [{ name: "ACCESS", value: WANTED }];

const cases: readonly { readonly name: string; readonly bindings: Parameters<typeof planVariables>[1]; readonly kind: string }[] = [
  { name: "a Worker without the variable", bindings: [{ name: "SITES", type: "r2_bucket" }], kind: "create" },
  { name: "the same value as an object", bindings: [{ name: "ACCESS", type: "json", json: WANTED }], kind: "leave" },
  { name: "the same value with its keys in another order", bindings: [{ name: "ACCESS", type: "json", json: { audience: WANTED.audience, team_domain: WANTED.team_domain } }], kind: "leave" },
  { name: "the same value as JSON text, as Cloudflare may hand a variable back", bindings: [{ name: "ACCESS", type: "json", json: JSON.stringify(WANTED) }], kind: "leave" },
  { name: "another audience", bindings: [{ name: "ACCESS", type: "json", json: { ...WANTED, audience: "b".repeat(64) } }], kind: "change" },
  { name: "one key more", bindings: [{ name: "ACCESS", type: "json", json: { ...WANTED, extra: "1" } }], kind: "change" },
  { name: "text that is no JSON", bindings: [{ name: "ACCESS", type: "json", json: "{" }], kind: "change" },
  { name: "the same text under another type", bindings: [{ name: "ACCESS", type: "plain_text", json: WANTED }], kind: "change" },
];

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const texts: readonly { readonly name: string; readonly bindings: Parameters<typeof planVariables>[1]; readonly kind: string }[] = [
  { name: "the same text", bindings: [{ name: "ACCOUNT_ID", type: "plain_text", text: ACCOUNT }], kind: "leave" },
  { name: "another text", bindings: [{ name: "ACCOUNT_ID", type: "plain_text", text: "f".repeat(32) }], kind: "change" },
  { name: "the same text kept as a secret, which reads back with no text", bindings: [{ name: "ACCOUNT_ID", type: "secret_text" }], kind: "change" },
  { name: "the same text inside a JSON variable", bindings: [{ name: "ACCOUNT_ID", type: "json", json: ACCOUNT }], kind: "change" },
];

// Drift: the account's id is a plain text and the other values are records; one compared as the other is rewritten on every repair, or never.
test.each(texts)("a plain text against $name is a $kind", ({ bindings, kind }) => {
  expect(planVariables([{ name: "ACCOUNT_ID", value: ACCOUNT }], bindings).map((step) => `${step.kind} ${step.subject}`)).toEqual([`${kind} ACCOUNT_ID`]);
});

// Drift: a value read as different when it is the same deploys the Worker anew on every repair, and one read as the same when it differs leaves a login nobody passes.
test.each(cases)("$name is a $kind", ({ bindings, kind }) => {
  expect(planVariables(DESIRED, bindings).map((step) => `${step.kind} ${step.subject}`)).toEqual([`${kind} ACCESS`]);
});

// Drift: a change names as kept only the bindings its own read listed. Sent after a read in part, it would drop the bucket, the database, and the key of a Worker that holds them.
test.each([
  ["no binding", { bindings: [] }],
  ["no list of bindings", {}],
  ["every binding but the Worker's own name", { bindings: emptyAccount().bindings.filter((binding) => binding.name !== "WORKER_NAME") }],
])("a change after a read of the Worker that answers %s is not sent: it fails as a read that got no answer, names the variable, and leaves every binding", async (_, answered) => {
  const worker = { accountId: ACCOUNT, script: "poplin" };
  const account = { ...emptyAccount(), trailing: { from: "now" as const, answers: [answered] } };
  const before = JSON.stringify(account.bindings);

  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const token = { ...connection, key: TOKEN };
      const wanted = [{ name: "ACCOUNT_ID", value: ACCOUNT }];

      expect(await syncVariables(token, worker, wanted, "apply")).toMatchObject({ ok: false, failure: "network", failed: "ACCOUNT_ID", unrun: [], report: { created: [], changed: [] } });
      expect([asked.filter((entry) => entry.method !== "GET"), JSON.stringify(account.bindings)]).toEqual([[], before]);
      expect(await syncVariables(token, worker, wanted, "apply")).toMatchObject({ ok: true, report: { created: ["ACCOUNT_ID"] } });
      expect(account.bindings.map((binding) => binding.name)).toEqual([...emptyAccount().bindings.map((binding) => binding.name), "ACCOUNT_ID"]);
    },
  );
});

// Drift: Cloudflare gives the version a change makes no annotation the change does not state. Untagged, the newest version of a release is one from before its variables and keys, and the install goes back to that one.
test.each([
  ["of a Worker that states its release tags the version it makes with it", [{ name: "RELEASE", type: "plain_text", text: "0.3.0" }], { "workers/tag": "0.3.0", "workers/message": "poplin 0.3.0, with its settings changed" }],
  ["of a Worker that states none tags nothing", [], undefined],
  ["of a Worker whose release is no version tags nothing", [{ name: "RELEASE", type: "plain_text", text: "v0.3.0" }], undefined],
] as const)("a change %s, and keeps the release as every other binding", async (_, stated, annotations) => {
  const account = { ...emptyAccount(), bindings: [...emptyAccount().bindings, ...stated] };

  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const secrets = [{ name: "KEPT_KEY", text: "a-key-of-the-test" }];

      expect(await syncVariables({ ...connection, key: TOKEN }, { accountId: ACCOUNT, script: "poplin" }, [{ name: "ACCOUNT_ID", value: ACCOUNT }], "apply", secrets)).toMatchObject({ ok: true });
      const change = asked.at(-1)?.body as { readonly settings: { readonly annotations?: unknown } } | undefined;

      expect(change?.settings.annotations).toEqual(annotations);
      expect([account.versions[0]?.annotations, account.bindings.filter((binding) => binding.name === "RELEASE")]).toEqual([annotations, [...stated]]);
    },
  );
});

// Drift: a dry run of an install reads the Worker before it exists. Read as a failure, every row after it would say "not run" where a run makes each one.
test("a Worker that does not exist is told apart from one with no binding, reads as one with none in a plan of its variables, and any other refusal stays a failure", async () => {
  const worker = { accountId: ACCOUNT, script: "poplin" };
  const account = { ...emptyAccount(), bindings: [], noWorker: true };

  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const token = { ...connection, key: TOKEN };

      expect([await readWorker(token, worker), await readBindings(token, worker)]).toEqual([
        { ok: true, value: undefined },
        { ok: true, value: [] },
      ]);
      expect(await syncVariables(token, worker, [{ name: "ACCOUNT_ID", value: ACCOUNT }], "plan")).toMatchObject({ ok: true, report: { created: ["ACCOUNT_ID"] } });

      account.noWorker = false;

      expect(await readWorker(token, worker)).toEqual({ ok: true, value: [] });
      expect(await readWorker({ ...connection, key: "token-nobody-knows-0123456789" }, worker)).toMatchObject({ ok: false, failure: "refused", status: 401 });
      expect(asked.filter((entry) => entry.method !== "GET")).toEqual([]);
    },
  );
});
