import { describe, expect, test, vi } from "vitest";
import { faultOf, logFault } from "../../../src/shared/worker/fault";

/** The id of a site nobody but its owner knows: the label its address begins with. */
const SITE = "quiet-harbor-meadow";

/** Everything of a fault a log or a thrown error shows. */
function shown(fault: Error): string {
  return [fault.name, fault.message, fault.stack, String(fault.cause)].join("\n");
}

describe("faultOf", () => {
  // Drift: an error's message repeats stored values for whoever reads the code, and Cloudflare keeps every line for days. An unlisted or private site's id is its link, so one message in the log hands the site to whoever reads the log.
  test("an error whose message and whose cause's message name a site becomes one of fixed words with its kind, its cause's kind, and the places it was thrown at, and no cause or word of either message", () => {
    const thrown = new RangeError(`site ${SITE} is live at version 3, which is not kept`, { cause: new TypeError(`sites/${SITE}/index.html is no key`) });

    const fault = faultOf("a request failed", thrown);
    const [first, ...frames] = (fault.stack ?? "").split("\n");

    expect([fault.message, first, fault.cause]).toEqual(["poplin: a request failed (RangeError, caused by TypeError)", "Error: poplin: a request failed (RangeError, caused by TypeError)", undefined]);
    // The places are the caught error's own, so Cloudflare maps the line that failed and not the line that made the fault.
    expect(frames).toEqual((thrown.stack ?? "").split("\n").filter((line) => /^\s*at /.test(line)).slice(0, 12));
    expect(frames.length).toBeGreaterThan(0);
    expect(shown(fault)).not.toContain(SITE);
  });

  // Drift: a stack starts with the message, and a message may hold lines of its own; one that reads as a place in the code would pass for one.
  test("a message with a line that reads as a place in the code is left out whole", () => {
    const fault = faultOf("a request failed", new Error("a stored login is not a login\n    at owner@example.com (worker.js:1:1)"));

    expect([fault.message, shown(fault).includes("owner@example.com")]).toEqual(["poplin: a request failed (Error)", false]);
  });

  test.each([
    { name: "a text", thrown: `site ${SITE} failed`, stack: "Error: poplin: a request failed (string)" },
    { name: "nothing", thrown: undefined, stack: "Error: poplin: a request failed (undefined)" },
  ])("$name that was thrown becomes a fault of its type alone, with no place", ({ thrown, stack }) => {
    expect(faultOf("a request failed", thrown).stack).toBe(stack);
  });
});

describe("logFault", () => {
  // Drift: Cloudflare maps the places of an error to the source and never those of a text, so a fault written as its stack's text would name the bundle's one line for good.
  test("the fault is written once, as an error", () => {
    using logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logFault("a request failed", new RangeError(`site ${SITE} failed`));

    expect(logged.mock.calls.map((call) => call.map((value) => (value instanceof Error ? value.message : typeof value)))).toEqual([["poplin: a request failed (RangeError)"]]);
  });
});
