// What the Access screen does with each answer to a change of a token's expiry: what the dialog is told, and whether the list reads again.

import { describe, expect, spyOn, test } from "bun:test";

import { accessActions } from "@/access/access-actions";
import type { Token } from "@/access/access-queries";

/** A token that works. */
const TOKEN = { id: "cd45ee5db1827382", scope: "publisher", note: "report agent", created: 1_794_000_000_000, expires: "never" } as Token;

/** What the server refuses a moment that has passed with. */
const PASSED = { ok: false, code: "bad_argument", about: "expires", sentence: "Pick a day that is still ahead." };

/** What the server says of a token that was revoked or ran out meanwhile. */
const GONE = { ok: false, code: "token_gone", about: null, sentence: "That token is gone already." };

/** What the dialog is told: nothing, which ends it, or a sentence, which it shows beside the choice it keeps. */
type Told = "nothing" | "the server's sentence" | "a sentence of the client's own";

/** Ask for a token to never expire, with every call of the client answered by `answer`; says what the dialog is told, and how often the list was read again. */
async function changed(answer: () => Response): Promise<readonly [told: Told, reads: number]> {
  let reads = 0;
  const actions = accessActions(
    () => (reads += 1),
    () => undefined,
  );
  const server = spyOn(globalThis, "fetch").mockImplementation((async () => answer()) as unknown as typeof fetch);

  try {
    const told = await actions.changeExpiry(TOKEN, "never");
    const sentence = told === PASSED.sentence ? "the server's sentence" : "a sentence of the client's own";

    return [told === undefined ? "nothing" : sentence, reads];
  } finally {
    server.mockRestore();
  }
}

/** A call that never reaches the server: the network is down. */
function unreached(): Response {
  throw new TypeError("the network is down");
}

describe("a change of a token's expiry", () => {
  // Drift: a Save that got no answer would end the dialog as a saved one does, and the choice would be lost with nothing changed.
  // A token that is gone would keep a dialog open in which no choice can do anything.
  test.each([
    ["one the server takes ends the dialog, and the list reads again", () => Response.json({ ok: true, expires: "never" }), "nothing", 1],
    ["a moment that has passed is said in the dialog, which keeps the choice", () => Response.json(PASSED, { status: 400 }), "the server's sentence", 0],
    ["a failure of the server's own is said in the dialog, which keeps the choice", () => new Response("", { status: 500 }), "a sentence of the client's own", 0],
    ["a call that got no answer is said in the dialog, which keeps the choice", unreached, "a sentence of the client's own", 0],
    ["a token that is gone ends the dialog, and the list reads again", () => Response.json(GONE, { status: 404 }), "nothing", 1],
  ] as const)("%s", async (_what, answer, told, reads) => {
    expect(await changed(answer)).toEqual([told, reads]);
  });
});
