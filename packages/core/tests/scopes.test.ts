import { describe, expect, test } from "bun:test";

import { type Actor, decideSiteAction, parseScope, type Scope, type SiteAction } from "../src/auth/scopes";

const HOLDER = "3f9a1c0b7d2e4a68";
const STRANGER = "0b7d2e4a683f9a1c";

type Row = readonly [scope: Scope, action: SiteAction, owner: string | undefined, verdict: unknown];

describe("decideSiteAction", () => {
  // Drift: this table is the product's whole promise of who may touch a site; a loosened row lets one agent overwrite or delete another's work.
  test.each([
    ["admin", "publish", undefined, { ok: true }],
    ["admin", "publish", HOLDER, { ok: true }],
    ["admin", "publish", STRANGER, { ok: true }],
    ["admin", "manage", undefined, { ok: true }],
    ["admin", "manage", HOLDER, { ok: true }],
    ["admin", "manage", STRANGER, { ok: true }],
    ["publisher", "publish", undefined, { ok: true }],
    ["publisher", "publish", HOLDER, { ok: true }],
    ["publisher", "publish", STRANGER, { ok: false, refusal: "taken" }],
    ["publisher", "manage", undefined, { ok: false, refusal: "not-owner" }],
    ["publisher", "manage", HOLDER, { ok: true }],
    ["publisher", "manage", STRANGER, { ok: false, refusal: "not-owner" }],
  ] as readonly Row[])("%s may %s a site owned by %j: %j", (scope, action, owner, verdict) => {
    const actor: Actor = { scope, holder: HOLDER };

    expect<unknown>(decideSiteAction(actor, action, owner)).toEqual(verdict);
  });
});

describe("parseScope", () => {
  // Drift: a scope read loosely from a stored record or a form would turn a misspelt or padded word into rights.
  test.each([
    ["publisher", "publisher"],
    ["admin", "admin"],
    ["Admin", undefined],
    ["admin ", undefined],
    ["", undefined],
    ["owner", undefined],
    ["publisher,admin", undefined],
    ["constructor", undefined],
  ] as ReadonlyArray<readonly [string, unknown]>)("reads %j as %j", (raw, scope) => {
    expect<unknown>(parseScope(raw)).toEqual(scope);
  });
});
