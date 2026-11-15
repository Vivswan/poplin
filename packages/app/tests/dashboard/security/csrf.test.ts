import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { checkCsrfToken, importCsrfKey, mintCsrfToken } from "../../../src/dashboard/security/csrf";

const NOW = 1_700_000_000_000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const EMAIL = "owner@example.com";

test("a token holds for the email and the key it was made with, for twelve hours, and for nothing else", async () => {
  const secret = new Uint8Array(32).fill(3);
  const key = await importCsrfKey(secret);
  const otherKey = await importCsrfKey(new Uint8Array(32).fill(4));
  const token = await mintCsrfToken({ key, email: EMAIL, now: NOW });
  const [issued = "", signature = ""] = token.split(".");
  const cases = [
    ["as made", token, { key, email: EMAIL, now: NOW }, true],
    ["at twelve hours", token, { key, email: EMAIL, now: NOW + TWELVE_HOURS_MS }, true],
    ["a millisecond past twelve hours", token, { key, email: EMAIL, now: NOW + TWELVE_HOURS_MS + 1 }, false],
    ["for another email", token, { key, email: "other@example.com", now: NOW }, false],
    ["under another key", token, { key: otherKey, email: EMAIL, now: NOW }, false],
    ["with a later issue time", `${NOW + 1}.${signature}`, { key, email: EMAIL, now: NOW }, false],
    ["with a changed signature", `${issued}.${signature.replace(/^./, (first) => (first === "0" ? "1" : "0"))}`, { key, email: EMAIL, now: NOW }, false],
    ["with capitals in the signature", `${issued}.${signature.toUpperCase()}F`.replace(/.F$/, "F"), { key, email: EMAIL, now: NOW }, false],
    ["with a short signature", `${issued}.${signature.slice(2)}`, { key, email: EMAIL, now: NOW }, false],
    ["with text after it", `${token}0`, { key, email: EMAIL, now: NOW }, false],
    ["with a line before it", `\n${token}`, { key, email: EMAIL, now: NOW }, false],
    ["empty", "", { key, email: EMAIL, now: NOW }, false],
    ["without a signature", `${issued}.`, { key, email: EMAIL, now: NOW }, false],
  ] as const;

  // Drift: open forms carry tokens written in lowercase hex; another spelling of the same signature would refuse every one of them.
  expect(token).toBe(`${NOW}.${createHmac("sha256", secret).update(`poplin-dashboard-csrf\n${EMAIL}\n${NOW}`).digest("hex")}`);

  for (const [what, value, binding, holds] of cases) expect([what, await checkCsrfToken(value, binding)]).toEqual([what, holds]);
});
