// The checks a stranger alone can make: what the install refuses without a token, what answers outside its hostnames, and what the rules in front of it stop.

import { expect } from "bun:test";

import type { Bench, Check, Missing } from "../records";
import { expectRefused, GHOST_ID, shownInTime } from "../util";

/** A user agent of an AI crawler the bot block stops. */
const CRAWLER = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";

/** The user agents of two assistants that open one page when their user asks for it, as each maker documents them. Neither crawls. */
const ASSISTANTS = [
  ["ChatGPT-User", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"],
  ["Perplexity-User", "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)"],
] as const;

/** What the line of the assistants' check ends with: which of the two things at the edge answered, and where the other is proved. */
const UNVERIFIED = "a run is no verified bot, so the bot switches answered, and the bots rule's pass for a verified assistant is held by the test of its expression";

/** What every team's login hostname ends in, and the path its login page of a hostname starts with: the edge's own redirect, which no install writes. */
const TEAM_LOGIN = { host: ".cloudflareaccess.com", path: "/cdn-cgi/access/login/" };

/** What the team's login page holds where it offers each login method, and what the run lacks where the account has none of it: the form of the code Cloudflare mails, with the box an email is typed into, and a button of each other. */
const LOGIN_METHODS: readonly { readonly name: string; readonly shown: RegExp; readonly lack?: keyof Missing }[] = [
  { name: "the email code", shown: /<form[^>]+id="totp-form"[\s\S]*?<input[^>]+type="email"/ },
  { name: "the Cloudflare login", shown: /data-idp="Cloudflare"/, lack: "cloudflare-login" },
  { name: "passkeys", shown: /data-idp="passkeys"/, lack: "passkeys" },
];

/** How long Cloudflare's edge may take to show a login method on the team's page after it was made, and how long a run rests between two looks: it follows within about 75 seconds. */
const LOGIN_PAGE_WITHIN = { ms: 180_000, pause: 15_000 } as const;

/** The paths of the dashboard a stranger must not reach the install on: its page, its data, a file of its client, and a page a link in a terminal opens. */
const BEHIND_LOGIN = ["/", "/data/frame", "/assets/index.js", "/tokens/review/x"];

/** What the dashboard's client sends with every call: the edge answers a script 401 where it would send a page on to the team's login. */
const BY_SCRIPT = { "X-Requested-With": "XMLHttpRequest" };

/** The code of the install's own refusal of a call no login stands behind. An answer of the edge never holds it. */
const OWN_REFUSAL = "no_login";

/** A token header in the shape the edge writes, which no team signed. */
const FORGED = { "Cf-Access-Jwt-Assertion": ["eyJhbGciOiJSUzI1NiJ9", "eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIn0", "c2lnbmVk"].join(".") };

/** A field's name that only an answer holding something of the install has. */
const DASHBOARD_DATA = /"(?:sites|email|logins|recent)"/;

/** What an answer's two headers hold when it lets no other origin read it. */
const NO_GRANT = [null, null] as const;

/** What a browser sends with an image a page of another domain loads. */
const OUTSIDE_PAGE = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" };

/** What the dashboard's hostname alone answers, as a path inside a site host: the API, the dashboard's data, and the login. */
const ADMIN_PATHS = ["api/whoami", "data/frame", "login/"];

/** Whether a hostname answers a stranger with a success; one that does not answer at all does not. */
async function answersOk(bench: Bench, address: string): Promise<boolean> {
  const response = await bench.visit(address).catch(() => undefined);

  return response?.ok === true;
}

/**
 * Whether an answer is the edge's own redirect to the team's login, which the install never sends: its own way to the login stays on its admin hostname.
 *
 * @returns `true` for a redirect to a login page under a team's hostname, off the install's domain
 */
function sentToTeamLogin(bench: Bench, response: Response): boolean {
  const location = response.headers.get("Location") ?? "";
  if (response.status !== 302 || !URL.canParse(location) || bench.addresses.isOwn(location)) return false;

  const { hostname, pathname } = new URL(location);

  return hostname.endsWith(TEAM_LOGIN.host) && pathname.startsWith(TEAM_LOGIN.path);
}

/**
 * Read the team's login page as a stranger reads it, until it offers every login method the account has or its time is up.
 *
 * @param page - where the edge sent the stranger; whatever it sends on to within the team's hostname is followed
 * @returns the name of each method the page did not come to offer; a method the run says the account has none of is not looked for
 */
async function methodsNotOffered(bench: Bench, page: string): Promise<string[]> {
  const expected = LOGIN_METHODS.filter(({ lack }) => lack === undefined || bench.missing[lack] === undefined);
  let absent = expected;
  const look = async (): Promise<boolean> => {
    const read = await bench.visit(page, { redirect: "follow" });
    const text = read.status === 200 ? await read.text() : "";
    absent = expected.filter(({ shown }) => !shown.test(text));

    return absent.length === 0;
  };
  await shownInTime(bench, look, LOGIN_PAGE_WITHIN);

  return absent.map(({ name }) => name);
}

/** The two headers by which an answer lets another origin read it: the origin it names, and whether the visitor's cookies may come along. */
function grantOf(response: Response): readonly [string | null, string | null] {
  return [response.headers.get("Access-Control-Allow-Origin"), response.headers.get("Access-Control-Allow-Credentials")];
}

/** Every check a stranger makes alone. */
export const EDGE_CHECKS: readonly Check[] = [
  {
    id: "api-token",
    name: "the API answers a request with no token itself, with no login in front: its own refusal, which says nothing of the install",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`${bench.admin}/api/sites`);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "not_logged_in" } });
    },
  },
  {
    id: "dashboard-login",
    name: "the edge sends a stranger to the team's login from every path of the dashboard, a forged token included, and answers a script's call 401 itself: the install is never asked, and sets no cookie",
    needs: ["access"],
    run: async (bench) => {
      for (const path of BEHIND_LOGIN) {
        const response = await bench.visit(`${bench.admin}${path}`);
        expect([path, sentToTeamLogin(bench, response)]).toEqual([path, true]);
        expect(response.headers.get("Set-Cookie") ?? "").not.toContain("poplin");
      }

      const forged = await bench.visit(`${bench.admin}/`, { headers: FORGED });
      expect(sentToTeamLogin(bench, forged)).toBe(true);

      // The client reads this 401 as a login that ended. A redirect here would be followed to a page of another origin, which a script cannot read.
      const called = await bench.visit(`${bench.admin}/data/frame`, { headers: BY_SCRIPT });
      expect([called.status, called.headers.get("Location"), (await called.text()).includes(OWN_REFUSAL)]).toEqual([401, null, false]);
    },
  },
  {
    id: "login-page",
    name: "the team's login page a stranger is sent to offers the Cloudflare login, the email code, and passkeys: a user who is no member of the Cloudflare account can log in",
    needs: ["access", "login-methods"],
    run: async (bench) => {
      const sent = await bench.visit(`${bench.admin}/`);
      expect(sentToTeamLogin(bench, sent)).toBe(true);

      expect(await methodsNotOffered(bench, sent.headers.get("Location") ?? "")).toEqual([]);
    },
  },
  {
    id: "login-path",
    name: "a path of the dashboard gives a stranger nothing of the install and no cookie, whether the edge or the install answers",
    needs: [],
    run: async (bench) => {
      for (const [path, headers] of [
        ["/", {}],
        ["/login", {}],
        ["/setup", {}],
        ["/data/frame", BY_SCRIPT],
        ["/data/sites", BY_SCRIPT],
      ] as const) {
        const response = await bench.visit(`${bench.admin}${path}`, { headers });
        const text = await response.text();
        // The edge's redirect or its 401, or the install's own refusal: 403 for a page, 401 for a call.
        expect(response.status, path).toBeOneOf([302, 401, 403]);
        expect(response.headers.get("Set-Cookie") ?? "", path).not.toContain("poplin");
        expect(DASHBOARD_DATA.test(text), path).toBe(false);
      }
    },
  },
  {
    id: "no-site",
    name: "a hostname that is no site's address answers the one 404, never cached",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(bench.addresses.openRoot);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await response.text()).toBe("Not found\n");
    },
  },
  {
    id: "method",
    name: "a site hostname refuses a method that changes something, before the install or in it",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(bench.addresses.openRoot, { method: "POST", body: "x" });
      expect(response.status).toBeOneOf([403, 405]);
      if (response.status === 405) expect(response.headers.get("Allow")).toBe("GET, HEAD");
    },
  },
  {
    id: "outside-hostnames",
    name: "a hostname beside the install's own, and one below its admin hostname, answer with no success",
    needs: [],
    run: async (bench) => {
      for (const address of bench.addresses.beside(bench.prefix)) expect(await answersOk(bench, address)).toBe(false);
    },
  },
  {
    id: "hosts-apart",
    name: "a site's address serves nothing of the API, the login, or the dashboard's data, and the dashboard's address serves no site",
    needs: ["token"],
    run: async (bench) => {
      const { site, text } = await bench.shared("unlisted");
      const { addresses } = bench;

      for (const inside of ADMIN_PATHS) {
        const open = await bench.visit(`${addresses.openRoot}${inside}`);
        // Compared here and told as one word: a failure prints nothing a host answered.
        expect([inside, open.status, (await open.text()) === "Not found\n"]).toEqual([inside, 404, true]);

        // The login may stand in front of this side: its redirect is no answer of the install either.
        const behind = await bench.visit(`${addresses.privateRoot}${inside}`);
        expect([inside, behind.status === 404 || sentToTeamLogin(bench, behind)]).toEqual([inside, true]);
      }

      const asSite = await bench.visit(`${bench.admin}/${site.label}/`);
      expect(asSite.status).toBeOneOf([302, 401, 403, 404]);
      await expectRefused(addresses, asSite, text);
    },
  },
  {
    id: "data-cross-origin",
    name: "the dashboard's data asked for by a page of a site is refused, a form's change too, and no answer of the install lets another origin read it",
    needs: [],
    run: async (bench) => {
      const origin = { Origin: new URL(bench.addresses.openRoot).origin };

      // The question a browser asks before a change is answered by whatever stands in front, with any status: what counts is that no answer holds the data, and none of the install grants the origin.
      for (const [what, refused, init] of [
        ["a read", true, { headers: origin }],
        ["a form's change", true, { method: "POST", headers: { ...origin, "Content-Type": "application/x-www-form-urlencoded" }, body: "name=x" }],
        ["a question before a change", false, { method: "OPTIONS", headers: { ...origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } }],
      ] as const) {
        const response = await bench.visit(`${bench.admin}/data/sites`, init);
        const text = await response.text();
        // The login's redirect lets the origin read it: an answer of the login's own, which holds nothing of the install.
        const granted = sentToTeamLogin(bench, response) ? NO_GRANT : grantOf(response);
        expect([what, refused && response.ok, granted, DASHBOARD_DATA.test(text)]).toEqual([what, false, NO_GRANT, false]);
      }

      // The login lets this path through on every install, so the answer is the install's own, on the hostname of the dashboard.
      const open = await bench.visit(`${bench.admin}/api/sites`, { headers: origin });
      expect([open.status, grantOf(open), DASHBOARD_DATA.test(await open.text())]).toEqual([401, NO_GRANT, false]);
    },
  },
  {
    id: "outside-page",
    name: "a file loaded by a page of another domain is refused, and the same file opened directly is not",
    needs: ["token"],
    run: async (bench) => {
      const { site } = await bench.shared("unlisted");
      expect((await bench.visit(site.url)).status).toBe(200);
      expect((await bench.visit(site.url, { headers: OUTSIDE_PAGE })).status).toBe(403);
    },
  },
  {
    id: "crawler",
    name: "an AI crawler's user agent is stopped before the install",
    needs: ["bot-block"],
    run: async (bench) => {
      const response = await bench.visit(bench.addresses.site(GHOST_ID, "u"), { headers: { "User-Agent": CRAWLER } });
      expect(response.status).toBe(403);
    },
  },
  {
    id: "assistant-fetch",
    name: "an assistant's user agent, opening one page for its user, is not stopped by the bot block that stops a crawler's",
    needs: ["bot-block"],
    // The request comes from no address the edge has verified as the assistant's, so the bots rule never reads it: the answer is that of the zone's bot switches.
    run: async (bench) => {
      const answers: string[] = [];
      const stopped: string[] = [];
      for (const [name, agent] of ASSISTANTS) {
        const { status } = await bench.visit(bench.addresses.site(GHOST_ID, "u"), { headers: { "User-Agent": agent } });
        answers.push(`${name} ${status === 403 ? "stopped" : "let through"} (${status})`);
        if (status === 403) stopped.push(name);
      }

      const line = `assistant-fetch: ${answers.join(", ")}; ${UNVERIFIED}`;
      expect(stopped, line).toEqual([]);
      bench.say(line);
    },
  },
];
