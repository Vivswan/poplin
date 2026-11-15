import { describe, expect, test } from "bun:test";
import { buildSession, importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Login, type Logins, parseLogin, parseLogins } from "@poplin/core/src/auth/logins";
import { mintSessionCookie, readSession } from "../../src/login/session";

const NOW = 1_700_000_000_000;
const NAME = "__Host-poplin-session";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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
    const value = await buildSession({ email: loginOf("owner@example.com"), issuedAt: NOW, maxAgeMs: THIRTY_DAYS_MS, key });

    const [pair, ...attributes] = (await mintSessionCookie({ email: loginOf("owner@example.com"), key, now: NOW })).split("; ");

    expect([pair, attributes.sort()]).toEqual([`${NAME}=${value}`, ["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Lax", "Secure"]]);
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

  // Drift: the cookie's own `Max-Age` is advice to a browser; a copied value must end on the server at the same 30 days.
  test.each([
    ["one second short of 30 days", THIRTY_DAYS_MS - 1000, { ok: true, value: "owner@example.com" }],
    ["at 30 days", THIRTY_DAYS_MS, { ok: false, refusal: "expired" }],
  ] as const)("a cookie read %s", async (_name, age, outcome) => {
    const key = await keyOf(1);

    expect<unknown>(await readSession(cookieHeader(await minted(key)), { key, logins: loginsOf("owner@example.com"), now: NOW + age })).toEqual(outcome);
  });

  // Drift: a removed login would keep its session for the rest of the 30 days.
  test("a genuine cookie whose email has left the logins is refused", async () => {
    const key = await keyOf(1);
    const headers = cookieHeader(await minted(key, "former@example.com"));

    expect(await readSession(headers, { key, logins: loginsOf("owner@example.com"), now: NOW })).toEqual({ ok: false, refusal: "not-a-login" });
  });

  // Drift: a browser holds one cookie of this name for the dashboard, so two in one request are not a browser's own; none would be picked from among them, whichever comes first.
  test.each([
    ["a planted one ahead of the real one", (real: string) => [`${NAME}=planted`, real]],
    ["a planted one behind the real one", (real: string) => [real, `${NAME}=planted`]],
    ["the real one twice", (real: string) => [real, real]],
  ] as const)("a request with %s is refused", async (_name, pairsOf) => {
    const key = await keyOf(1);
    const session = await readSession(cookieHeader(...pairsOf(await minted(key))), { key, logins: loginsOf("owner@example.com"), now: NOW });

    expect(session).toEqual({ ok: false, refusal: "several" });
  });

  // Drift: a name a sibling hostname can set would be taken as the session again. A browser keeps a no-break space, and other characters a text trim drops, as part of a cookie's name: such a name is one a site may choose.
  test.each([
    ["the name before this one", "__Secure-poplin-session"],
    ["the name with no prefix", "poplin-session"],
    ["the prefix in small letters", "__host-poplin-session"],
    ["a no-break space before the name", `${String.fromCharCode(0xa0)}${NAME}`],
    ["a line separator before the name", `${String.fromCharCode(0x2028)}${NAME}`],
    ["a byte-order mark before the name", `${String.fromCharCode(0xfeff)}${NAME}`],
  ])("a genuine value under %s is no session, and beside the real cookie it does not count as a second one", async (_case, other) => {
    const key = await keyOf(1);
    const real = await minted(key);
    const check = { key, logins: loginsOf("owner@example.com"), now: NOW };
    const planted = `${other}=${real.slice(NAME.length + 1)}`;
    // A host hands the header over as text, which may hold characters the `Headers` class of a test's runtime refuses.
    const sent = (...pairs: string[]): { get: () => string } => ({ get: () => pairs.join("; ") });

    expect([await readSession(sent(planted), check), await readSession(sent(real, planted), check)]).toEqual([
      { ok: false, refusal: "missing" },
      { ok: true, value: loginOf("owner@example.com") },
    ]);
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
