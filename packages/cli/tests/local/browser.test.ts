import { describe, expect, test } from "bun:test";

import { openBrowser } from "../../src/local/browser";
import { type Machine, thisMachine } from "../../src/local/login-file";

/** An address an install hands over to be opened. */
const ADDRESS = "https://poplin.example.com/tokens/review/0123456789abcdef";

/** Every variable a command reads a token from. */
const TOKENS = ["POPLIN_TOKEN", "POPLIN_INSTALL_TOKEN"];

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

  // Drift: what is started inherits this process's environment, and a browser lives long after the run: a token left there stays readable by every process of the same user.
  // The command goes on while the browser starts, so the environment it read beforehand must still hold each token.
  test.each([
    ["starts", async (): Promise<void> => undefined, true],
    ["cannot be started", (): Promise<void> => Promise.reject(new Error("spawn xdg-open ENOENT")), false],
  ])("a browser that %s sees none of the tokens, the command beside it still reads each, and each is back afterwards", async (_name, outcome, opened) => {
    const kept = [...TOKENS, "POPLIN_SERVER"].map((name) => [name, process.env[name]] as const);
    const held = TOKENS.map((name) => `token-in-${name}`);
    const seen: unknown[] = [];
    for (const name of TOKENS) process.env[name] = `token-in-${name}`;
    process.env.POPLIN_SERVER = "https://poplin.example.com";
    const command = thisMachine();

    try {
      const started = await openBrowser(ADDRESS, machineOf(), () => {
        seen.push(
          TOKENS.map((name) => process.env[name]),
          process.env.POPLIN_SERVER,
          TOKENS.map((name) => command.env[name]),
        );

        return outcome();
      });
      const after = TOKENS.map((name) => process.env[name]);

      expect([started, seen, after]).toEqual([opened, [[undefined, undefined], "https://poplin.example.com", held], held]);
    } finally {
      for (const [name, value] of kept) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("a browser that cannot be started is not an error: the login goes on with the printed address", async () => {
    expect(await openBrowser(ADDRESS, machineOf(), () => Promise.reject(new Error("spawn xdg-open ENOENT")))).toBe(false);
  });
});
