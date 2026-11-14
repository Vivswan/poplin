// The checks of the access letter and of what stands in front of the install. Each runs only on an install that enforces the letter; the ones a person makes are listed here so a run names them.
//
//   L1   the login covers every letter p hostname
//   L2   a private site frames another private site               a person, three browser engines
//   L3   a second private site opens with no prompt               a person
//   L4   an unlisted link set private: logged out, then logged in the logged-in half is a person's
//   L5   a letter p hostname without a valid login token answers no file
//   L5b  the same with the login application removed              a person
//   L6   the CPU time of a private request                        a person
//   L7   a removed login is locked out within a minute            a person
//   L8   another method, a scanner's path, and plain http are stopped before the install
//   L9   the first open after a publish, in real browsers         a person
//   L10  a publish of many small files meets no rate rule
//   L11  a computer's login request reaches the API with no login in front

import { expect } from "bun:test";

import type { Check } from "../records";
import { expectRefused, GHOST_ID, isOwnAddress, labelAddress } from "../util";

/** What a request that came around the login may carry in place of a token the login signed. */
const FORGED: readonly (readonly [what: string, headers: Readonly<Record<string, string>>])[] = [
  ["no token", {}],
  ["a header that is no token", { "Cf-Access-Jwt-Assertion": "not-a-token" }],
  ["a cookie that is no token", { Cookie: "CF_Authorization=not-a-token" }],
  ["a token nobody signed", { "Cf-Access-Jwt-Assertion": unsignedToken() }],
];

/** A login token in the right shape that no login signed: it is put together here, so the source holds nothing shaped like a token. */
function unsignedToken(): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

  return [part({ alg: "none" }), part({ email: "owner@example.com" }), "made-up"].join(".");
}

/** A check only a person can make: it never runs, and a run lists it as skipped. */
function byHand(id: string, name: string): Check {
  return {
    id,
    name,
    needs: ["person"],
    run: async () => {
      throw new Error(`${id} is made by hand`);
    },
  };
}

/** Every check of the letter and of what stands in front of the install. */
export const LETTER_CHECKS: readonly Check[] = [
  {
    id: "L1",
    name: "a private site's address sends a stranger to the login, off the install's domain",
    needs: ["token", "letters", "access"],
    run: async (bench) => {
      const text = "<p>behind login</p>";
      const site = await bench.publish({ access: "private", text });

      const response = await bench.visit(site.url);
      expect(response.status).toBeOneOf([302, 303]);
      const location = response.headers.get("Location") ?? "";
      expect(URL.canParse(location) && !isOwnAddress(bench.domain, location)).toBe(true);
      await expectRefused(bench.domain, response, text);
    },
  },
  byHand("L2", "a private site shows another private site in a frame, in three browser engines"),
  byHand("L3", "a second private site opens with no login prompt"),
  {
    id: "L4",
    name: "an unlisted link set private sends a stranger to the letter p address, path and query kept",
    needs: ["token", "letters"],
    run: async (bench) => {
      const text = "<p>was unlisted</p>";
      const site = await bench.publish({ access: "unlisted", text });
      expect((await bench.cli("set", site.label, "--private")).code).toBe(0);

      const response = await bench.visit(`${site.url}/page?from=link`);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(`${labelAddress(bench.domain, site.label, "p")}page?from=link`);
      await expectRefused(bench.domain, response, text);
    },
  },
  byHand("L4-in", "the same link, opened logged in, lands on the site at its letter p address"),
  {
    id: "L5",
    name: "a letter p address hands out no file without a token the login signed",
    needs: ["token", "letters"],
    run: async (bench) => {
      const text = "<p>no token</p>";
      const site = await bench.publish({ access: "private", text });

      for (const [what, headers] of FORGED) {
        const response = await bench.visit(site.url, { headers });
        // With no login in front, the request reaches the install, which answers the one 404.
        if (bench.missing.access !== undefined) expect(response.status, what).toBe(404);

        await expectRefused(bench.domain, response, text);
      }
    },
  },
  byHand("L5b", "with the login application removed, a letter p address answers 404"),
  byHand("L6", "the CPU time of a private request stays inside the plan's limit"),
  byHand("L7", "a login removed on the dashboard is locked out of private sites within a minute"),
  {
    id: "L8-method",
    name: "a method that changes something is stopped before the install",
    needs: ["guard-rules"],
    run: async (bench) => {
      const response = await bench.visit(labelAddress(bench.domain, GHOST_ID, "u"), { method: "POST", body: "x" });
      expect(response.status).toBe(403);
    },
  },
  {
    id: "L8-scanner",
    name: "a scanner's path is stopped before the install",
    needs: ["guard-rules"],
    run: async (bench) => {
      const response = await bench.visit(`${labelAddress(bench.domain, GHOST_ID, "u")}wp-login.php`);
      expect(response.status).toBe(403);
    },
  },
  {
    id: "L8-http",
    name: "plain http is sent to https, on a site address and on the admin hostname",
    needs: ["https-redirect"],
    run: async (bench) => {
      const site = labelAddress(bench.domain, GHOST_ID, "u");

      for (const address of [`${site}page`, `${bench.admin}/login`]) {
        const response = await bench.visit(address.replace("https://", "http://"));
        expect(response.status, address).toBeOneOf([301, 308]);
        expect(response.headers.get("Location"), address).toBe(address);
      }
    },
  },
  byHand("L9", "the first open after a publish shows the new version, in real browsers"),
  {
    id: "L10",
    name: "a publish of many small files is finished, and no rate rule answers it",
    needs: ["token", "many-files"],
    run: async (bench) => {
      const ran = await bench.cli("publish", bench.manyFiles(), "--name", `${bench.prefix}-many`, "--unlisted", "--expires", "1d");
      expect(ran.code).toBe(0);
      expect(ran.value.site).toMatchObject({ access: "unlisted", live_version: 1 });
    },
  },
  {
    id: "L11",
    name: "a computer's request to log in is answered by the API as JSON, with no login in front of it",
    needs: [],
    run: async (bench) => {
      const response = await bench.visit(`${bench.admin}/api/logins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toStartWith("application/json");
      expect(await response.json()).toMatchObject({ error: { code: "bad_argument" } });
    },
  },
];
