import { describe, expect, test } from "bun:test";

import { openBrowser } from "../../src/local/browser";
import type { Machine } from "../../src/local/login-file";

const ADDRESS = "https://poplin.example.com/tokens/allow?code=WDJB-MJHT";
const DESKTOP = { DISPLAY: ":0" };

/** What a machine was asked to start, each as the command and its arguments. */
function recorder(fails = false): { readonly started: string[][]; readonly start: NonNullable<Parameters<typeof openBrowser>[2]> } {
  const started: string[][] = [];

  return {
    started,
    start: (command, args, options) => {
      if (fails) throw new Error("spawn ENOENT");

      started.push([command, ...args, JSON.stringify(options)]);

      return { on: () => undefined, unref: () => undefined };
    },
  };
}

function machineOf(platform: string, env: Readonly<Record<string, string>> = {}): Machine {
  return { env, platform, home: "/home/ada" };
}

describe("openBrowser", () => {
  // Drift: the address comes from an install's answer; a command that read it through a shell would run whatever followed an `&` in it.
  test.each([
    ["darwin", {}, ["open", ADDRESS]],
    ["win32", {}, ["rundll32", "url.dll,FileProtocolHandler", ADDRESS]],
    ["linux", DESKTOP, ["xdg-open", ADDRESS]],
    ["linux", { WAYLAND_DISPLAY: "wayland-0" }, ["xdg-open", ADDRESS]],
  ])("on %s the address is one argument of one command, started detached with nothing attached", (platform, env, command) => {
    const { started, start } = recorder();

    expect([openBrowser(ADDRESS, machineOf(platform, env), start), started]).toEqual([true, [[...command, '{"detached":true,"stdio":"ignore"}']]]);
  });

  // Drift: a browser opened where nobody sits is seen by nobody, and on a server it can be a text browser that takes the terminal over.
  test.each([
    ["over SSH", "darwin", { SSH_CONNECTION: "192.0.2.1 50000 192.0.2.2 22" }],
    ["on an SSH terminal", "linux", { ...DESKTOP, SSH_TTY: "/dev/pts/0" }],
    ["in CI", "win32", { CI: "true" }],
    ["on a Linux machine with no display", "linux", {}],
    ["on a platform with no known command", "freebsd", DESKTOP],
  ])("%s nothing is started", (_where, platform, env) => {
    const { started, start } = recorder();

    expect([openBrowser(ADDRESS, machineOf(platform, env), start), started]).toEqual([false, []]);
  });

  // Drift: only an address a browser opens as a web page is handed over; a file or a script address would be run by the machine, not shown.
  test.each(["http://poplin.example.com/", "file:///etc/passwd", "javascript:alert(1)", "--help", "", "poplin.example.com"])("%j is no address to open", (address) => {
    const { started, start } = recorder();

    expect([openBrowser(address, machineOf("darwin"), start), started]).toEqual([false, []]);
  });

  test("a command that cannot be started is not an error: the login goes on with the printed address", () => {
    expect(openBrowser(ADDRESS, machineOf("darwin"), recorder(true).start)).toBe(false);
  });
});
