import { beforeAll, describe, expect, test } from "bun:test";
import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Logins, parseLogins } from "@poplin/core/src/auth/logins";
import { accessIdentity } from "../../src/login/access-token";
import { accessKeys } from "../../src/login/keys";
import { logIn } from "@poplin/app/src/login/login";
import { readSession } from "@poplin/app/src/login/session";
import { hostnameAddresses } from "@poplin/app/src/sites/hostname-addresses";
import { SUFFIXED } from "../zone/support/layouts";
import { AUDIENCE, certs, headersOf, NOW, type Signer, sign, signer, TEAM } from "./support/access";

const ADDRESSES = hostnameAddresses(SUFFIXED);

let team: Signer;
let stranger: Signer;
let sessionKey: CryptoKey;

type Outcome = Awaited<ReturnType<typeof logIn>>;

function loginsOf(...emails: string[]): Logins {
  const logins = parseLogins(emails);
  if (!logins.ok) throw new Error(`the test's logins were refused: ${logins.refusal}`);

  return logins.value;
}

function attempt(token: string | undefined, returnTo?: string): Promise<Outcome> {
  const keys = accessKeys({ teamDomain: TEAM, fetch: certs(team).fetch });

  const identify = accessIdentity({ keys, audience: AUDIENCE });

  return logIn(headersOf(token), { identify, logins: loginsOf("owner@example.com", "second@example.com"), sessionKey, now: NOW, addresses: ADDRESSES, returnTo });
}

beforeAll(async () => {
  team = await signer("team-key");
  stranger = await signer("stranger-key");
  sessionKey = await importSessionKey(new Uint8Array(32).fill(7));
});

describe("the login", () => {
  // Drift: the cookie handed out would name someone other than the token's person, or not read back as a session at all.
  test("a listed email, in whatever case Access sends it, gets a session that reads back as that login", async () => {
    const outcome = await attempt(await sign(team, { email: "Second@Example.com" }), "/sites?sort=new");
    if (!outcome.ok) throw new Error(`the login was refused: ${outcome.refusal}`);

    const cookie = outcome.setCookie.slice(0, outcome.setCookie.indexOf(";"));
    const session = await readSession(new Headers({ Cookie: cookie }), { key: sessionKey, logins: loginsOf("second@example.com"), now: NOW });

    expect({ email: outcome.email, location: outcome.location, session }).toMatchObject({
      email: "second@example.com",
      location: "/sites?sort=new",
      session: { ok: true, value: "second@example.com" },
    });
  });

  // Drift: a request Access never signed, or signed for someone not listed, would be handed a cookie.
  test.each([
    ["a person Access let in who is not in the logins", "not-a-login", (): Promise<string> => sign(team, { email: "guest@example.com" })],
    ["a listed email in a token another key signed", "bad-signature", (): Promise<string> => sign(stranger, {}, team.kid)],
    ["a listed email in a token for another application", "wrong-audience", (): Promise<string> => sign(team, { aud: "another-application" })],
    ["no token, only a claim to be the owner", "missing", (): undefined => undefined],
  ])("%s gets no cookie: %s", async (_name, refusal, token) => {
    expect(await attempt(await token(), "/sites")).toEqual({ ok: false, refusal } as Outcome);
  });

  // Drift: the login would send the owner to another origin right after signing in.
  test.each([undefined, "https://evil.example/", "//evil.example", "/\\evil.example", "/.//evil.example"])("a return to %p lands on the dashboard root", async (returnTo) => {
    expect(await attempt(await sign(team), returnTo)).toMatchObject({ ok: true, location: "/" });
  });

  // Drift: serving writes the return and the login reads it; if the two forms part, a visitor of a private site lands on the dashboard instead of the page they asked for.
  test("the return serving writes for a private site's address brings the visitor back to that address", async () => {
    const asked = "https://secret--k3f9x2ab71qz-page.example.com/notes/page.html?x=1";
    const returnTo = new URL(ADDRESSES.loginFor(new URL(asked))).searchParams.get("return");

    expect(await attempt(await sign(team), returnTo ?? undefined)).toMatchObject({ ok: true, location: asked });
  });
});
