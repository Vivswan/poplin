import { describe, expect, test } from "bun:test";

import type { Installer } from "../../../../core/src/install/installer";
import { TOKEN_VARIABLE } from "../../../src/install/ask";
import { parseUninstall } from "../../../src/install/remove/parse";
import { words } from "../../commands/support/command-line";
import { emptyAccount, standIn, TOKEN } from "../support/stand-in";

/** The one made-up provider. */
const PROVIDERS = [standIn(emptyAccount()) as Installer<unknown, unknown>];

/** The environment of a line whose token is in its variable. */
const HELD = { [TOKEN_VARIABLE]: TOKEN };

/** Read one command line as the command does: the words after `poplin uninstall`. */
function parsed(line: string, env: Readonly<Record<string, string | undefined>> = HELD, canAsk = false): ReturnType<typeof parseUninstall> {
  return parseUninstall(words(`poplin ${line}`).slice(1), PROVIDERS, env, canAsk);
}

/** The mode of a line that came to a plan; the lines of one that was refused. */
function read(line: string, env?: Readonly<Record<string, string | undefined>>, canAsk?: boolean): unknown {
  const answer = parsed(line, env, canAsk);
  if (answer.kind === "plan") return { asking: answer.plan.asking, mode: answer.plan.mode };

  if (answer.kind !== "stop") return answer.kind;

  return answer.stop.problem === "missing_answer" ? { missing: answer.stop.missing.map((one) => one.key) } : answer.stop;
}

describe("the proof of a removal", () => {
  // Drift: the proof is the one thing between a line and a removed install. A plan that removes without one would be a removal nobody confirmed.
  test.each([
    ["uninstall stand-in --no-place --dry-run", { asking: "never", mode: { mode: "dry-run", data: "remove" } }],
    ["uninstall stand-in --no-place --dry-run --keep-data", { asking: "never", mode: { mode: "dry-run", data: "keep" } }],
    ["uninstall stand-in --no-place --confirm poplin.example.com", { asking: "never", mode: { mode: "apply", confirm: { by: "flag", typed: "poplin.example.com" }, data: "remove" } }],
    ["uninstall stand-in --no-place --confirm=poplin.example.com --keep-data --yes", { asking: "never", mode: { mode: "apply", confirm: { by: "flag", typed: "poplin.example.com" }, data: "keep" } }],
    ["uninstall stand-in --no-place", { missing: ["confirm"] }],
    ["uninstall stand-in", { missing: ["where", "confirm"] }],
  ])("a line that asks nothing: %s", (line, plan) => {
    expect(read(line)).toEqual(plan);
  });

  test("a line with no token and no proof names both, and --yes alone is refused in its own words: without this an agent reads --yes as a yes", () => {
    expect(read("uninstall stand-in --no-place", {})).toEqual({ missing: ["token", "confirm"] });
    expect(read("uninstall stand-in --no-place --yes")).toEqual({ problem: "usage", exit: 2, lines: ["--yes does not confirm an uninstall", "Fix: pass --confirm <text>, which a run with --dry-run prints"] });
  });

  test("on a terminal the proof is typed unless the line gave it, and a dry run asks for none: without this a person is asked to confirm a list", () => {
    expect(read("uninstall stand-in --no-place", HELD, true)).toEqual({ asking: "terminal", mode: { mode: "apply", confirm: { by: "typing" }, data: "remove" } });
    expect(read("uninstall stand-in --no-place --confirm poplin.example.com --keep-data", HELD, true)).toEqual({ asking: "terminal", mode: { mode: "apply", confirm: { by: "flag", typed: "poplin.example.com" }, data: "keep" } });
    expect(read("uninstall stand-in --no-place --dry-run", HELD, true)).toEqual({ asking: "terminal", mode: { mode: "dry-run", data: "remove" } });
  });
});

describe("a line that is written wrong", () => {
  // Drift: each refusal is one line a person acts on. Commander's own words would name neither the command nor the way out.
  test.each([
    ["uninstall stand-in --no-place --dry-run --confirm poplin.example.com", ["--dry-run and --confirm are mutually exclusive"]],
    ["uninstall stand-in --no-place --confirm=", ["--confirm requires the text --dry-run shows", "Fix: get the text from a run with --dry-run"]],
    ["uninstall stand-in --no-place --force", ["Unknown option --force", "Fix: confirm with --confirm <text>"]],
    ["uninstall stand-in --no-place --user you@example.com", ["Unknown option --user", "Fix: remove --user"]],
    ["uninstall stand-in --no-place --alias mine --dry-run", ["Unknown option --alias", "See: poplin uninstall stand-in --help"]],
    ["uninstall stand-in --place example.com --no-place --dry-run", ["--place and --no-place are mutually exclusive"]],
    ["uninstall nowhere --dry-run", ['Unknown provider "nowhere"', "See: poplin uninstall"]],
    ["uninstall stand-in --no-place --dry-run --token-stdin", [`${TOKEN_VARIABLE} and --token-stdin are mutually exclusive`]],
  ])("%s", (line, lines) => {
    expect(read(line)).toEqual({ problem: "usage", exit: 2, lines });
  });

  test("a line that names no provider lists them, asks which on a terminal, or names the provider as missing: without this `poplin uninstall` alone does nothing a person can read", () => {
    expect([read("uninstall"), read("uninstall --json"), read("uninstall", HELD, true), read("uninstall --dry-run")]).toEqual(["list", "list", "pick", { missing: ["provider"] }]);
    expect([read("uninstall --help"), read("uninstall stand-in --help"), read("uninstall --version")]).toEqual(["help", "help", "version"]);
  });
});
