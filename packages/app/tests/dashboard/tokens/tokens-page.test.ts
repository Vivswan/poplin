import { expect, test } from "bun:test";

import { mintToken } from "@poplin/core/src/auth/tokens";

import { NOW } from "../../sites/support/install";
import { type Opened, openDashboard } from "../support/install";

const HOSTILE = `"><script>alert(1)</script>`;

/** Store a token made a moment after the fixture's start; answers the token and its record. */
async function stored(opened: Opened, scope: "admin" | "publisher", note: string, after: number): Promise<Awaited<ReturnType<typeof mintToken>>> {
  const minted = await mintToken({ scope, note, now: NOW + after });
  await opened.install.database.addToken(minted.record, { by: opened.owner, at: NOW + after });

  return minted;
}

test("every token is a row, the newest first: its name, its role, its id, when it was made, and when it runs out, with a button that revokes it", async () => {
  const opened = await openDashboard();
  const admin = await stored(opened, "admin", "laptop", 1);
  const publisher = await stored(opened, "publisher", "", 2);

  const page = await (await opened.get("/tokens")).text();
  const rows = [...page.matchAll(/<tr>\n<td class="wrap">([^<]*)<\/td>\n<td>([^<]*)<\/td>\n<td><code>([^<]*)<\/code><\/td>\n<td><time[^>]*>([^<]*)<\/time><\/td>\n<td>(?:<time[^>]*>)?([^<]*)/g)].map((row) => row.slice(1));

  expect(rows).toEqual([
    ["no name", "publisher", publisher.record.id, "2023-11-14 22:13 UTC", "never"],
    ["laptop", "admin", admin.record.id, "2023-11-14 22:13 UTC", "2023-12-14 22:13 UTC"],
  ]);
  expect(page.match(/<form method="post" action="\/tokens\/revoke"><input type="hidden" name="csrf" value="[^"]+"><input type="hidden" name="token" value="[0-9a-f]{16}">/g)?.length).toBe(2);
  expect(page).toContain("<th scope=\"col\">Name</th><th scope=\"col\">Role</th><th scope=\"col\">Id</th><th scope=\"col\">Made</th><th scope=\"col\">Runs out</th><th scope=\"col\">Revoke</th>");
});

test("no token and no hash of one is on the page, and a token's name reaches it escaped", async () => {
  const opened = await openDashboard();
  const minted = [await stored(opened, "admin", HOSTILE, 1), await stored(opened, "publisher", "ci", 2)];

  const page = await (await opened.get("/tokens")).text();

  expect(page).toContain('<td class="wrap">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</td>');
  expect(minted.flatMap(({ token, record }) => [token, record.hash, token.slice(-64)]).filter((secret) => page.includes(secret))).toEqual([]);
  expect([page.includes("<script>"), /poplin_[0-9a-f]{16}_/.test(page)]).toEqual([false, false]);
});
