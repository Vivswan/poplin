import { describe, expect, test, vi } from "vitest";
import { logFault } from "../../src/worker/fault";

/** The id of a site nobody but its owner knows: the label its address begins with. */
const SITE = "quiet-harbor-meadow";

function linesOf(thrown: unknown): readonly string[] {
  using logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logFault("a request failed", thrown);

  return logged.mock.calls.flatMap((call) => call.map(String));
}

describe("logFault", () => {
  // Drift: an error's message repeats stored values for whoever reads the code, and Cloudflare keeps every line for days. An unlisted or private site's id is its link, so one message in the log hands the site to whoever reads the log.
  test("an error whose message and whose cause's message name a site is logged once, by its kind, its cause's kind, and where it was thrown, with no word of either message", () => {
    const thrown = new RangeError(`site ${SITE} is live at version 3, which is not kept`, { cause: new TypeError(`sites/${SITE}/index.html is no key`) });

    const [line, ...more] = linesOf(thrown);
    const [first, ...frames] = (line ?? "").split("\n");

    expect([first, more]).toEqual(["poplin: a request failed (RangeError, caused by TypeError)", []]);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => !/^\s*at /.test(frame))).toEqual([]);
    expect(line).not.toContain(SITE);
  });

  // Drift: a stack starts with the message, and a message may hold lines of its own; one that reads as a place in the code would pass for one.
  test("a message with a line that reads as a place in the code is left out whole", () => {
    const [line] = linesOf(new Error("a stored login is not a login\n    at owner@example.com (worker.js:1:1)"));

    expect([line?.startsWith("poplin: a request failed (Error)\n"), line?.includes("owner@example.com")]).toEqual([true, false]);
  });

  test.each([
    { name: "a text", thrown: `site ${SITE} failed`, line: "poplin: a request failed (string)" },
    { name: "nothing", thrown: undefined, line: "poplin: a request failed (undefined)" },
  ])("$name that was thrown is logged by its type alone", ({ thrown, line }) => {
    expect(linesOf(thrown)).toEqual([line]);
  });
});
