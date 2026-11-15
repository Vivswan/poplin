import { describe, expect, test } from "bun:test";

import { openBrowser } from "../../src/local/browser";
import type { Machine } from "../../src/local/login-file";

const ADDRESS = "https://poplin.example.com/tokens/allow?code=WDJB-MJHT";

/** What was handed to the browser. */
function recorder(): { readonly started: string[][]; readonly start: NonNullable<Parameters<typeof openBrowser>[2]> } {
  const started: string[][] = [];

  return {
    started,
    start: async (...handed) => {
      started.push(handed);
    },
  };
}

function machineOf(env: Readonly<Record<string, string>> = {}): Machine {
  return { env, platform: "linux", home: "/home/ada" };
}

describe("openBrowser", () => {
  // Drift: the address comes from an install's answer; handed over changed, or with anything beside it, the browser would open another page.
  test("at a desk the address is handed to the browser as it came, and nothing else with it", async () => {
    const { started, start } = recorder();

    expect([await openBrowser(ADDRESS, machineOf(), start), started]).toEqual([true, [[ADDRESS]]]);
  });

  // Drift: a browser opened where nobody sits is seen by nobody.
  test.each([
    ["over SSH", { SSH_CONNECTION: "192.0.2.1 50000 192.0.2.2 22" }],
    ["on an SSH terminal", { DISPLAY: ":0", SSH_TTY: "/dev/pts/0" }],
    ["in CI", { CI: "true" }],
  ])("%s nothing is started", async (_where, env) => {
    const { started, start } = recorder();

    expect([await openBrowser(ADDRESS, machineOf(env), start), started]).toEqual([false, []]);
  });

  // Drift: only an address a browser opens as a web page is handed over; a file or a script address would be run by the machine, not shown.
  test.each(["http://poplin.example.com/", "file:///etc/passwd", "javascript:alert(1)", "--help", "", "poplin.example.com"])("%j is no address to open", async (address) => {
    const { started, start } = recorder();

    expect([await openBrowser(address, machineOf(), start), started]).toEqual([false, []]);
  });

  test("a browser that cannot be started is not an error: the login goes on with the printed address", async () => {
    expect(await openBrowser(ADDRESS, machineOf(), () => Promise.reject(new Error("spawn xdg-open ENOENT")))).toBe(false);
  });
});
