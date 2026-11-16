// Every login of the dashboard ended at Cloudflare with the kept key, against the answers Cloudflare documents for its Access applications.
// Without these a press could end the logins of another application, read as done when Cloudflare refused it, or give the key away in an answer.

import { describe, expect, test } from "bun:test";
import type { EndLogins } from "@poplin/core/src/actions/sign-out";
import { readKeptKey } from "../../src/key/kept-key";
import { createEndLogins } from "../../src/key/logins-end";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";
import { withFake } from "../zone/support/fake-cloudflare";
import { type Asked, page, refusal } from "../zone/support/replies";

/** The account the applications are in. */
const ACCOUNT = "account-a";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** Where the applications are listed. */
const APPS = `/accounts/${ACCOUNT}/access/apps`;

/** The applications the account holds: poplin's guarded one between its open one and one of somebody else's. */
const HELD = [
  { id: "app-open", name: INSTALL_OBJECTS.accessOpenApplication },
  { id: "app-1", name: INSTALL_OBJECTS.accessApplication },
  { id: "app-other", name: "wiki" },
];

/** What Access answers a taken request with: 202, and no result to read. */
const TAKEN = (): Response => Response.json({ success: true, errors: [], messages: [], result: true }, { status: 202 });

/** A failure of Cloudflare's own, which the SDK tries again at once. */
const DOWN = (): Response => refusal(503, 1, `Service unavailable ${KEY}`, { "retry-after-ms": "1" });

/** What a fake account answers each call with. Left out, the list holds the three applications and the request is taken. */
interface Account {
  readonly apps?: (asked: Asked) => Response;
  readonly revoke?: () => Response;
}

/** Answer as the account does: the list of applications, and the request to end the logins of poplin's guarded one. */
function account(answers: Account): (asked: Asked) => Response | undefined {
  const calls: Readonly<Record<string, (asked: Asked) => Response>> = {
    [`GET ${APPS}`]: answers.apps ?? ((asked) => page(asked, HELD)),
    [`POST ${APPS}/app-1/revoke_tokens`]: answers.revoke ?? TAKEN,
  };

  return (asked) => calls[`${asked.method} ${asked.path.split("?")[0]}`]?.(asked);
}

/** The writes among what was asked, each as its method and its path. */
function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`);
}

describe("createEndLogins", () => {
  // Drift: the request names one application by its id. The open paths' application, or one of another tool in the same account, must never be the one whose logins end.
  test("a press asks Access once to take back the tokens of poplin's guarded application, and of no other", async () => {
    await withFake(account({}), async (connection, asked) => {
      const ended = await createEndLogins(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT)();

      expect([ended, writes(asked)]).toEqual([{ ok: true }, [`POST ${APPS}/app-1/revoke_tokens`]]);
      expect(new Set(asked.map((entry) => entry.key))).toEqual(new Set([`Bearer ${KEY}`]));
    });
  });

  const refused: readonly { readonly name: string; readonly answers: Account; readonly ends: Awaited<ReturnType<EndLogins>>; readonly written: number }[] = [
    { name: "a key Cloudflare no longer knows", answers: { apps: () => refusal(401, 10_000, `Authentication error ${KEY}`) }, ends: { ok: false, refusal: "key_refused" }, written: 0 },
    { name: "a key with no right to end logins", answers: { revoke: () => refusal(403, 10_000, "Authentication error") }, ends: { ok: false, refusal: "lacks_right" }, written: 1 },
    { name: "Cloudflare failing while the applications are read", answers: { apps: DOWN }, ends: { ok: false, refusal: "unreachable" }, written: 0 },
    { name: "Cloudflare failing while the logins are ended", answers: { revoke: DOWN }, ends: { ok: false, refusal: "unreachable" }, written: 3 },
    { name: "an account with no guarded application of poplin's", answers: { apps: (asked) => page(asked, [HELD[0], HELD[2]]) }, ends: { ok: false, refusal: "not_made" }, written: 0 },
  ];

  // Drift: each answer is one of the refusals the screen has a sentence for. One that read as done would leave every login alive behind the word that it ended.
  test.each(refused)("$name ends as $ends, and no text of the answer holds the key", async ({ answers, ends, written }) => {
    await withFake(account(answers), async (connection, asked) => {
      const ended = await createEndLogins(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT)();

      expect([ended, writes(asked).length]).toEqual([ends, written]);
      expect([JSON.stringify(ended), Bun.inspect(ended)].join("\n")).not.toContain(KEY);
    });
  });
});
