import { describe, expect, test } from "bun:test";
import { buildSession, importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Login, type Logins, parseLogin, parseLogins } from "@poplin/core/src/auth/logins";
import { mintSessionCookie, readSession } from "../../src/login/session";

const NOW = 1_700_000_000_000;
const NAME = "__Secure-poplin-session";

function loginOf(email: string): Login {
  const login = parseLogin(email);
  if (!login.ok) throw new Error(`the test's email was refused: ${login.refusal}`);

  return login.value;
}

function loginsOf(...emails: string[]): Logins {
  const logins = parseLogins(emails);
  if (!logins.ok) throw new Error(`the test's logins were refused: ${logins.refusal}`);

  return logins.value;
}

function keyOf(fill: number): Promise<CryptoKey> {
  return importSessionKey(new Uint8Array(32).fill(fill));
}

function cookieHeader(...pairs: string[]): Headers {
  return new Headers(pairs.length === 0 ? {} : { Cookie: pairs.join("; ") });
}

async function minted(key: CryptoKey, email = "owner@example.com", now = NOW): Promise<string> {
  const cookie = await mintSessionCookie({ email: loginOf(email), key, now });

  return cookie.slice(0, cookie.indexOf(";"));
}

describe("the session cookie", () => {
  // Drift: an attribute dropped here lets a script read the cookie or a cross-site post carry it, and a `Domain` added here sends the dashboard's session to every site of the install.
  test("it is written with exactly the attributes the browser must enforce, and for the hostname that set it alone", async () => {
    const key = await keyOf(1);
    const value = await buildSession({ email: loginOf("owner@example.com"), issuedAt: NOW, key });

    expect(await mintSessionCookie({ email: loginOf("owner@example.com"), key, now: NOW })).toBe(`${NAME}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
  });

  // Drift: the reader and the writer would disagree on the name or the form, and every login would bounce.
  test("a cookie just written reads back as its email, among other cookies", async () => {
    const key = await keyOf(1);
    const headers = cookieHeader("theme=dark", await minted(key), "lang=en");

    expect(await readSession(headers, { key, logins: loginsOf("owner@example.com"), now: NOW + 1000 })).toEqual({ ok: true, value: loginOf("owner@example.com") });
  });

  // Drift: "sign everyone out" would rotate the key and leave the old cookies working.
  test("a cookie signed under the old key stops verifying once the key is rotated", async () => {
    const headers = cookieHeader(await minted(await keyOf(1)));
    const logins = loginsOf("owner@example.com");

    expect(await readSession(headers, { key: await keyOf(1), logins, now: NOW })).toMatchObject({ ok: true });
    expect(await readSession(headers, { key: await keyOf(2), logins, now: NOW })).toEqual({ ok: false, refusal: "bad-signature" });
  });

  // Drift: a removed login would keep its session for the rest of the 30 days.
  test("a genuine cookie whose email has left the logins is refused", async () => {
    const key = await keyOf(1);
    const headers = cookieHeader(await minted(key, "former@example.com"));

    expect(await readSession(headers, { key, logins: loginsOf("owner@example.com"), now: NOW })).toEqual({ ok: false, refusal: "not-a-login" });
  });

  // Drift: a site of the same domain could plant a cookie of this name ahead of the real one and sign the owner out.
  test("a planted cookie ahead of the real one does not hide it", async () => {
    const key = await keyOf(1);
    const headers = cookieHeader(`${NAME}=planted`, await minted(await keyOf(2)), await minted(key));

    expect(await readSession(headers, { key, logins: loginsOf("owner@example.com"), now: NOW })).toMatchObject({ ok: true });
  });

  // Drift: a request without a usable cookie would throw, or be told apart wrongly by the caller.
  test.each([
    ["no Cookie header", [], "missing"],
    ["other cookies only", ["theme=dark", "lang=en"], "missing"],
    ["a name that only ends like ours", [`x${NAME}=abc`], "missing"],
    ["an empty value", [`${NAME}=`], "malformed"],
    ["a value that is no session", [`${NAME}=owner@example.com`], "malformed"],
  ] as const)("%s is refused", async (_name, pairs, refusal) => {
    const session = await readSession(cookieHeader(...pairs), { key: await keyOf(1), logins: loginsOf("owner@example.com"), now: NOW });

    expect(session).toEqual({ ok: false, refusal });
  });
});
