// Opening an address in the person's browser: one command a platform, run without a shell, and never waited for.

import { spawn } from "node:child_process";

import type { Machine } from "./login-file";

/** The command that hands an address to the default browser, by `process.platform`. None of them reads the address as anything but one argument. */
const OPENERS: Readonly<Record<string, readonly [command: string, ...leading: string[]]>> = {
  darwin: ["open"],
  win32: ["rundll32", "url.dll,FileProtocolHandler"],
  linux: ["xdg-open"],
};

/** The variables that say the person sits at another machine, or at none: a browser opened here would be seen by nobody. */
const NOBODY_HERE = ["SSH_CONNECTION", "SSH_TTY", "CI"];

/** The variables one of which a Linux desktop sets. */
const LINUX_DISPLAYS = ["DISPLAY", "WAYLAND_DISPLAY"];

/** The scheme of the one kind of address that is opened. */
const SECURE = "https:";

/** The part of `spawn` a browser is started with. */
type Start = (command: string, args: readonly string[], options: { readonly detached: true; readonly stdio: "ignore" }) => { on(event: "error", heard: () => void): unknown; unref(): void };

function isSet(machine: Machine, name: string): boolean {
  return (machine.env[name] ?? "") !== "";
}

/**
 * Hand an `https://` address to the person's browser, when this machine looks like one a person sits at.
 *
 * @param start - what starts the command; `spawn` when absent
 * @returns whether a command was started. A command that is not there, or that fails, is not heard of: the address is printed either way
 */
export function openBrowser(address: string, machine: Machine, start: Start = spawn): boolean {
  const opener = Object.hasOwn(OPENERS, machine.platform) ? OPENERS[machine.platform] : undefined;
  if (opener === undefined || URL.parse(address)?.protocol !== SECURE) return false;

  if (NOBODY_HERE.some((name) => isSet(machine, name))) return false;

  if (machine.platform === "linux" && !LINUX_DISPLAYS.some((name) => isSet(machine, name))) return false;

  const [command, ...leading] = opener;

  try {
    const browser = start(command, [...leading, address], { detached: true, stdio: "ignore" });
    browser.on("error", () => undefined);
    browser.unref();
  } catch {
    return false;
  }

  return true;
}
