// Bearer tokens and emails arrive from the internet: the auth parsers must refuse, never throw, and let nothing but the genuine credential through.
//
// HTML_STANDARD_EMAIL is the address grammar a browser's email field applies, copied from the HTML standard.

import { expect } from "bun:test";
import fc from "fast-check";

import { parseLogin } from "../../packages/core/src/auth/logins";
import { mintToken, parseToken, verifyToken } from "../../packages/core/src/auth/tokens";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const HTML_STANDARD_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const YEAR_2100_MS = 4_102_444_800_000;

type Change = { readonly kind: "replace" | "insert" | "delete" | "nudge"; readonly at: number; readonly fromEnd: boolean; readonly character: string; readonly step: number };

const property = fuzzTarget(import.meta.file);

const emails = hostile(fc.emailAddress());
const words = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const ordinaryEmails = fc.tuple(fc.array(words, { minLength: 1, maxLength: 3 }), fc.array(words, { minLength: 2, maxLength: 4 })).map(([local, domain]) => `${local.join(".")}@${domain.join(".")}`);
const paddings = fc.constantFrom("", " ", "\t", "\n");
const tokens = hostile(fc.stringMatching(/^poplin_[0-9a-f]{16}_[0-9a-f]{64}$/));
const clocks = fc.oneof(fc.integer({ min: 0, max: YEAR_2100_MS }), fc.double());
const mintRequests = fc.record({ scope: fc.constantFrom("publisher" as const, "admin" as const), note: hostile(fc.constant("laptop")), now: fc.integer({ min: 0, max: YEAR_2100_MS }) });

const changes: fc.Arbitrary<Change> = fc.record({
  kind: fc.constantFrom("replace" as const, "insert" as const, "delete" as const, "nudge" as const),
  at: fc.oneof(fc.nat({ max: 3 }), fc.nat()),
  fromEnd: fc.boolean(),
  character: fc.oneof(fc.constantFrom(..."0123456789abcdefABCDEFxyzXYZ_-. "), fc.string({ unit: "binary", minLength: 1, maxLength: 1 })),
  step: fc.constantFrom(-3, -2, -1, 1, 2, 3),
});

// A nudge moves a character to a neighbour in its alphabet: the change most likely to decode to the same bytes.
function changeOneCharacter(text: string, change: Change): string {
  const offset = change.at % text.length;
  const at = change.fromEnd ? text.length - 1 - offset : offset;
  const head = text.slice(0, at);
  const tail = text.slice(at + 1);

  if (change.kind === "insert") return `${head}${change.character}${text.slice(at)}`;

  if (change.kind === "delete") return `${head}${tail}`;

  if (change.kind === "nudge") return `${head}${String.fromCharCode(text.charCodeAt(at) + change.step)}${tail}`;

  return `${head}${change.character}${tail}`;
}

property(
  "a hostile bearer token is refused without a throw under any clock, so nothing but the minted token opens a record",
  fc.asyncProperty(tokens, mintRequests, clocks, fc.context(), async (presented, request, now, context) => {
    const { record } = await mintToken(request);
    context.log(`record: ${JSON.stringify(record)}`);
    parseToken(presented);

    expect((await verifyToken(presented, record, now)).ok).toBe(false);
  }),
);

property(
  "a minted token verifies against its own record and never against the record of another token",
  fc.asyncProperty(mintRequests, mintRequests, fc.context(), async (request, other, context) => {
    const minted = await mintToken(request);
    const stranger = await mintToken(other);
    context.log(`token: ${minted.token}, stranger: ${stranger.token}`);

    expect<unknown>(parseToken(minted.token)).toEqual({ ok: true, value: minted.record.id });
    expect(await verifyToken(minted.token, minted.record, request.now)).toEqual({ ok: true, value: minted.record });
    expect(await verifyToken(minted.token, stranger.record, request.now)).toEqual({ ok: false, refusal: "mismatch" });
  }),
);

property(
  "a token with one character changed, added, or dropped no longer verifies, so a near miss is never let through",
  fc.asyncProperty(mintRequests, changes, fc.context(), async (request, change, context) => {
    const { token, record } = await mintToken(request);
    const changed = changeOneCharacter(token, change);
    context.log(`token: ${token}, changed: ${JSON.stringify(changed)}`);
    fc.pre(changed !== token);

    expect((await verifyToken(changed, record, request.now)).ok).toBe(false);
  }),
);

property(
  "a hostile email is refused without a throw, and an accepted login is an address by the HTML standard, the trimmed input in ASCII lowercase, and parses to itself",
  fc.property(emails, (raw) => {
    const login = parseLogin(raw);
    if (!login.ok) return;

    expect<unknown>(parseLogin(login.value)).toEqual(login);
    expect(raw.trim()).toMatch(/^[\x21-\x7e]+$/);
    expect(raw.trim().toLowerCase()).toBe(login.value);
    expect(login.value).toMatch(HTML_STANDARD_EMAIL);
  }),
);

property(
  "an ordinary address in any ASCII case with whitespace around it is accepted as its lowercase form, so the owner is never locked out by typing",
  fc.property(fc.mixedCase(ordinaryEmails), paddings, paddings, (email, before, after) => {
    expect<unknown>(parseLogin(`${before}${email}${after}`)).toEqual({ ok: true, value: email.toLowerCase() });
  }),
);
