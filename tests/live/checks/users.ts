// The check of the users: one added through the install reaches the login list at the provider by itself, and one removed leaves it, with no repair between.

import { expect } from "bun:test";

import type { Bench, Check } from "../records";

/** How long the provider's list may take to show a change it took, in milliseconds, and how long one look waits for the next. */
const SHOWN_WITHIN = { ms: 20_000, pause: 2000 } as const;

/** The logins of the install as its settings hold them, in order. */
async function storedLogins(bench: Bench): Promise<string[]> {
  const shown = await bench.cli("config", "logins");
  expect(shown.code).toBe(0);

  return (shown.value.values as { logins: string[] }).logins;
}

/** Look at the provider's list until an email is there, or is gone, and answer whether it came to that in time. */
async function listed(bench: Bench, email: string, wanted: boolean): Promise<boolean> {
  const until = bench.now() + SHOWN_WITHIN.ms;

  for (;;) {
    if ((await bench.loginList()).includes(email) === wanted) return true;

    if (bench.now() >= until) return false;

    await bench.pause(SHOWN_WITHIN.pause);
  }
}

/** The check of the users. The email it adds is of a domain kept for documents: nobody holds it, and the check takes it out again whatever it met. */
export const USER_CHECKS: readonly Check[] = [
  {
    id: "users-follow",
    name: "a user added through the install is in the login list at the provider with no repair, and a user removed is out of it",
    needs: ["token", "access", "kept-key", "login-list"],
    run: async (bench) => {
      const before = await storedLogins(bench);
      const email = `${bench.prefix}@example.com`;

      try {
        expect((await bench.cli("config", "logins", [...before, email].join(","))).code).toBe(0);
        expect(await listed(bench, email, true)).toBe(true);
      } finally {
        expect((await bench.cli("config", "logins", before.join(","))).code).toBe(0);
      }

      expect(await listed(bench, email, false)).toBe(true);
      // Compared here and told as one word: a failure prints no email of the install.
      const after = [...(await bench.loginList())].sort();
      expect(after.join() === [...before].sort().join()).toBe(true);
    },
  },
];
