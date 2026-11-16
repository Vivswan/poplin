import { afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { admit } from "@poplin/app/src/login/admit";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { SignJWT, UnsecuredJWT } from "jose";
import { accessIdentity } from "../../../src/shared/login/access-token";
import { accessKeys } from "../../../src/shared/login/keys";
import { AUDIENCE, type Certs, certs, claims, headersOf, NOW, NOW_SECONDS, type Signer, sign, signer, TEAM } from "./support/access";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const LEEWAY = 30;
const CERTS_URL = "https://team.cloudflareaccess.com/cdn-cgi/access/certs";

let team: Signer;
let stranger: Signer;

type Verdict = Awaited<ReturnType<ReturnType<typeof accessIdentity>>>;
type Forgery = readonly [name: string, refusal: string, token: () => Promise<string | undefined> | string | undefined];

/** Check a token at a time. The keys are kept by the clock of the runtime, so that clock is set to the time. */
function check(served: Certs, token: string | undefined, now: number = NOW, keys = accessKeys({ teamDomain: TEAM, fetch: served.fetch })): Promise<Verdict> {
  setSystemTime(new Date(now));

  return accessIdentity({ keys, audience: AUDIENCE })(headersOf(token), now);
}

function refused(refusal: string): Verdict {
  return { ok: false, refusal } as Verdict;
}

function part(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

beforeAll(async () => {
  team = await signer("team-key");
  stranger = await signer("stranger-key");
});

afterEach(() => {
  setSystemTime();
});

describe("the dashboard's admission over the real check", () => {
  // Drift: a request Access never signed, or signed for somebody who is no user, would be admitted; or a user would be kept out by the case Access wrote the email in.
  test.each([
    ["a user, in whatever case Access sends the email", { ok: true, actor: { scope: "admin", holder: "second@example.com" }, since: NOW - 10_000 }, (): Promise<string> => sign(team, { email: "Second@Example.com" })],
    ["a person Access let in who is no user", { ok: false, refusal: "not-a-user" }, (): Promise<string> => sign(team, { email: "guest@example.com" })],
    ["a user's email in a token another key signed", { ok: false, refusal: "bad-signature" }, (): Promise<string> => sign(stranger, {}, team.kid)],
    ["a user's email in a token for another application", { ok: false, refusal: "wrong-audience" }, (): Promise<string> => sign(team, { aud: "another-application" })],
    ["a user's token that ran out", { ok: false, refusal: "expired" }, (): Promise<string> => sign(team, { exp: NOW_SECONDS - 31 })],
    ["no token, only a claim to be the owner", { ok: false, refusal: "missing" }, (): undefined => undefined],
  ])("%s is answered whole", async (_name, outcome, token) => {
    const users = parseLogins(["owner@example.com", "second@example.com"]);
    if (!users.ok) throw new Error(`the test's users were refused: ${users.refusal}`);

    const identify = accessIdentity({ keys: accessKeys({ teamDomain: TEAM, fetch: certs(team).fetch }), audience: AUDIENCE });
    const headers = headersOf(await token());
    if ("refusal" in outcome && outcome.refusal === "missing") headers.set("X-Forwarded-Email", "owner@example.com");
    setSystemTime(new Date(NOW));

    expect<unknown>(await admit(headers, { identify, logins: users.value, now: NOW })).toEqual(outcome);
  });
});

describe("an Access token", () => {
  // Drift: the email would be trusted in the case Access sent it, and no longer match the logins' normal form; or the login would be dated by the request, and every request would look like a new login.
  test("a live token of this team and application gives its email in lowercase, and the moment Access issued it", async () => {
    const verdict = await check(certs(team), await sign(team, { email: "Owner@Example.COM", iat: NOW_SECONDS - 4000, nbf: NOW_SECONDS - 4000 }), NOW);
    const later = await check(certs(team), await sign(team, { iat: NOW_SECONDS - 4000, nbf: NOW_SECONDS - 4000 }), NOW + 1000 * 1000);

    expect([verdict, later]).toEqual([
      { ok: true, value: "owner@example.com", since: NOW - 4_000_000 },
      { ok: true, value: "owner@example.com", since: NOW - 4_000_000 },
    ] as Verdict[]);
  });

  // Drift: a second audience on a token would lock the owner out.
  test("one matching audience among several is enough", async () => {
    const verdict = await check(certs(team), await sign(team, { aud: ["another-application", AUDIENCE] }));

    expect(verdict.ok).toBe(true);
  });

  // Drift: any check dropped from the verification lets a token through that Access never issued for this login.
  const forgeries: readonly Forgery[] = [
    ["no header at all", "missing", () => undefined],
    ["an empty header", "missing", () => ""],
    ["text that is no token", "malformed", () => "owner@example.com"],
    ["two dots of nothing", "malformed", () => ".."],
    ["a token longer than any Access issues", "malformed", async () => `${await sign(team)}${"A".repeat(8192)}`],
    ["alg none, no signature", "malformed", () => new UnsecuredJWT(claims()).encode()],
    ["alg none under the team's key id", "malformed", () => `${part({ alg: "none", kid: team.kid })}.${part(claims())}.`],
    [
      "HS256, signed with the public key as the secret",
      "malformed",
      async () => new SignJWT(claims()).setProtectedHeader({ alg: "HS256", kid: team.kid }).sign(new Uint8Array(await crypto.subtle.exportKey("spki", team.pair.publicKey))),
    ],
    ["no key id in the header", "malformed", () => sign(team, {}, null)],
    ["a stranger's key under the team's key id", "bad-signature", () => sign(stranger, {}, team.kid)],
    ["a payload changed after signing", "bad-signature", async () => (await sign(team)).replace(/\.[^.]+\./, `.${part(claims({ email: "thief@example.com" }))}.`)],
    ["a token for another application", "wrong-audience", () => sign(team, { aud: ["another-application"] })],
    ["an audience that only starts like ours", "wrong-audience", () => sign(team, { aud: `${AUDIENCE}0` })],
    ["no audience", "malformed", () => sign(team, { aud: undefined })],
    ["another team's issuer", "wrong-issuer", () => sign(team, { iss: "https://other.cloudflareaccess.com" })],
    ["our issuer with a trailing slash", "wrong-issuer", () => sign(team, { iss: `${TEAM}/` })],
    ["no issuer", "malformed", () => sign(team, { iss: undefined })],
    ["expired one second beyond the leeway", "expired", () => sign(team, { exp: NOW_SECONDS - LEEWAY })],
    ["no expiry", "malformed", () => sign(team, { exp: undefined })],
    ["an expiry that is text", "malformed", () => sign(team, { exp: "tomorrow" })],
    ["not valid until after the leeway", "not-yet-valid", () => sign(team, { nbf: NOW_SECONDS + LEEWAY + 1 })],
    ["issued after the leeway", "not-yet-valid", () => sign(team, { iat: NOW_SECONDS + LEEWAY + 1, nbf: undefined })],
    ["no issue time", "malformed", () => sign(team, { iat: undefined })],
    ["a service token, which names no person", "no-email", () => sign(team, { email: undefined, common_name: "a-service.access" })],
    ["an email that is a list", "no-email", () => sign(team, { email: ["owner@example.com"] })],
    ["an email that is no address", "no-email", () => sign(team, { email: "owner" })],
  ];

  test.each(forgeries)("%s is refused as %s", async (_name, refusal, token) => {
    expect(await check(certs(team), await token())).toEqual(refused(refusal));
  });

  // Drift: the leeway would move, or apply on one side only, and logins would fail on a clock a few seconds off.
  test("the leeway is 30 seconds on each of the three times", async () => {
    const edges = [{ exp: NOW_SECONDS - LEEWAY + 1 }, { nbf: NOW_SECONDS + LEEWAY }, { iat: NOW_SECONDS + LEEWAY, nbf: undefined }];
    const verdicts = await Promise.all(edges.map(async (edge) => check(certs(team), await sign(team, edge))));

    expect(verdicts.map((verdict) => verdict.ok)).toEqual([true, true, true]);
  });
});

describe("the team's keys", () => {
  // Drift: a forged key id on every request would become a fetch of the certs address on every request.
  test("an unknown key id costs one fetch a minute, however many tokens name one", async () => {
    const served = certs(team);
    const keys = accessKeys({ teamDomain: TEAM, fetch: served.fetch });
    const forged = await sign(stranger);

    expect(await check(served, await sign(team), NOW, keys)).toMatchObject({ ok: true });
    expect(served.calls).toEqual([CERTS_URL]);

    expect(await check(served, forged, NOW + MINUTE_MS, keys)).toEqual(refused("unknown-key"));
    expect(served.calls).toHaveLength(2);

    expect(await check(served, forged, NOW + MINUTE_MS + 1000, keys)).toEqual(refused("unknown-key"));
    expect(await check(served, await sign(stranger, {}, "another-forged-id"), NOW + 2 * MINUTE_MS - 1, keys)).toEqual(refused("unknown-key"));
    expect(served.calls).toHaveLength(2);

    expect(await check(served, forged, NOW + 2 * MINUTE_MS, keys)).toEqual(refused("unknown-key"));
    expect(served.calls).toHaveLength(3);
  });

  // Drift: a token that names no key, checked against a team with two, would be answered as keys that cannot be had: a 503 that asks a forger to come back, where the token is refused.
  test("a token with no key id is malformed whichever keys the team has", async () => {
    const served = certs(team, await signer("second-key"));

    expect(await check(served, await sign(team, {}, null))).toEqual(refused("malformed"));
  });

  // Drift: after Access rotates its key, logins would fail until the hour's cache ran out.
  test("a key Access rotated in is found by the one refetch", async () => {
    const served = certs(team);
    const keys = accessKeys({ teamDomain: TEAM, fetch: served.fetch });
    const rotated = await signer("rotated-key");

    await check(served, await sign(team), NOW, keys);
    served.keys = [team.jwk, rotated.jwk];

    expect(await check(served, await sign(rotated), NOW + MINUTE_MS, keys)).toMatchObject({ ok: true });
    expect(served.calls).toHaveLength(2);
  });

  // Drift: keys would be kept forever, and a key Access retired would verify tokens for as long as the isolate lives.
  test("keys are used for an hour, then fetched again, and a retired key stops verifying", async () => {
    const served = certs(team);
    const keys = accessKeys({ teamDomain: TEAM, fetch: served.fetch });
    const later = { iat: NOW_SECONDS + 3590, nbf: undefined, exp: NOW_SECONDS + 7200 };

    await check(served, await sign(team), NOW, keys);
    await check(served, await sign(team), NOW + HOUR_MS - 1, keys);
    expect(served.calls).toHaveLength(1);

    served.keys = [stranger.jwk];

    expect(await check(served, await sign(team, later), NOW + HOUR_MS, keys)).toEqual(refused("unknown-key"));
    expect(served.calls).toHaveLength(2);
  });

  // Drift: a failing certs address would throw out of the login, or be asked again by every request while it is down.
  test("a certs address that is down refuses the login and is asked once a minute", async () => {
    const served = certs(team);
    const keys = accessKeys({ teamDomain: TEAM, fetch: served.fetch });
    const token = await sign(team);
    served.down = true;

    expect(await check(served, token, NOW, keys)).toEqual(refused("keys-unavailable"));
    expect(await check(served, token, NOW + 1000, keys)).toEqual(refused("keys-unavailable"));
    expect(served.calls).toHaveLength(1);

    served.down = false;

    expect(await check(served, token, NOW + MINUTE_MS, keys)).toMatchObject({ ok: true });
    expect(served.calls).toHaveLength(2);
  });

  // Drift: an answer that is not a key set would be cached as one, or crash the request.
  test.each([
    ["a page that is not JSON", (): Response => new Response("<html>")],
    ["JSON with no keys", (): Response => Response.json({ public_cert: "x" })],
    ["a 503", (): Response => Response.json({ keys: [] }, { status: 503 })],
  ])("%s from the certs address refuses the login", async (_name, answer) => {
    const keys = accessKeys({ teamDomain: TEAM, fetch: async () => answer() });

    expect(await accessIdentity({ keys, audience: AUDIENCE })(headersOf(await sign(team)), NOW)).toEqual(refused("keys-unavailable"));
  });
});
