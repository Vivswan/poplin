// What the console answers while a day's allowance is used up. Without it the owner reads "Internal Server Error" on the one day they most need to be told why, and a client asks again all day.

import { describe, expect, test } from "bun:test";
import { AllowanceSpent } from "@poplin/core/src/database/driver";

import { openConsole } from "./support/console";

/** The fixtures' moment is 22:13:20 UTC: 6,400 seconds before midnight. */
const WAIT = "6400";

/** The sentence of each allowance. */
const SENTENCES = {
  no_more_writing: "The database takes no more changes today: its free allowance for writing is used up. Changes work again after midnight UTC.",
  no_more_reading: "The dashboard is paused: the free allowance of the database for reading is used up for today. It is back after midnight UTC.",
} as const;

/** What an answer says, as a test compares it. */
async function told(answer: Response): Promise<unknown[]> {
  const body = await answer.text();

  return [answer.status, answer.headers.get("Retry-After"), answer.headers.get("Cache-Control"), body.startsWith("{") ? JSON.parse(body) : body];
}

describe("a console whose install meets a day's allowance that is used up", () => {
  // Drift: the client shows the sentence of a refusal it is sent, and has none of its own for a status of 500.
  test("answers a change with the refusal and the wait, as the JSON its client reads", async () => {
    const opened = await openConsole("/next");
    opened.base.install.database.appendAudit = () => Promise.reject(new AllowanceSpent("writing"));

    const answer = await opened.change("/data/settings/sign-everyone-out", {});

    expect(await told(answer)).toEqual([503, WAIT, "no-store", { ok: false, code: "allowance_spent", about: "writing", sentence: SENTENCES.no_more_writing }]);
  });

  // Drift: a page has no client yet to draw a refusal, and the frame it would be drawn in reads the database, which one that gives no more reading cannot.
  test("answers a page in plain words with the wait", async () => {
    const opened = await openConsole("/next");
    // The users are read before it; the frame's own read is the one that meets the spent day.
    opened.base.install.database.readFrame = () => Promise.reject(new AllowanceSpent("reading"));

    expect(await told(await opened.get("/settings"))).toEqual([503, WAIT, "no-store", `${SENTENCES.no_more_reading}\n`]);
  });

  // Drift: an answer made for every failure would tell a fault of the code as a spent day, and the host's log would never hold it.
  test("hands any other failure to its host", async () => {
    const opened = await openConsole("/next");
    const fault = new Error("the database is away");
    opened.base.install.database.appendAudit = () => Promise.reject(fault);

    expect(opened.change("/data/settings/sign-everyone-out", {})).rejects.toBe(fault);
  });
});
