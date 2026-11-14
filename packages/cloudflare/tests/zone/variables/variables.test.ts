import { expect, test } from "bun:test";
import { planVariables } from "../../../src/zone/variables/variables";

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
