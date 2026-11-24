import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { TOKEN_VARIABLES } from "../../src/local/current-login";

/** A code a login hands over to be copied. */
const CODE = "WDJB-MJHT";

/** Every variable a command reads a token from. */
const TOKENS = Object.values(TOKEN_VARIABLES);

/** What the library starts to copy a text, by where it runs: macOS, Linux under X11 and under Wayland, and WSL. */
const TOOLS = ["pbcopy", "xsel", "wl-copy", "clip.exe"];

/** The platforms whose tool a file of that name on the path can stand in for. */
const STOOD_IN = ["darwin", "linux"];

/** A stand-in for the platform's tool: it keeps what it is given, and each token of its own environment after it, in the file `TAKEN` names. */
const STAND_IN = `#!/bin/sh\n{ cat; echo "|${TOKENS.map((name) => `$${name}`).join("|")}|"; } > "$TAKEN"\n`;

/** A program that copies its last argument as the command does, at a desk, and prints whether it was copied. */
const PROGRAM = `import { copyText } from ${JSON.stringify(join(import.meta.dir, "..", "..", "src", "local", "clipboard.ts"))};
console.log(await copyText(process.argv.at(-1) ?? "", { env: {}, platform: process.platform, home: "" }));`;

describe("copyText", () => {
  // Drift: a copy that fails says nothing, by design. A library whose call changed, or that no longer reached the platform's own tool, would leave every login at "Code:" with no test red.
  // What holds a clipboard on Linux stays behind when the command ends, with the environment it inherited: a token left there stays readable by every process of the same user.
  test.skipIf(!STOOD_IN.includes(process.platform))("the library hands the platform's own tool the text and nothing else, with none of the tokens to inherit", () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-clipboard-"));
    const taken = join(scratch.path, "taken");
    for (const tool of TOOLS) writeFileSync(join(scratch.path, tool), STAND_IN, { mode: 0o755 });
    const tokens = Object.fromEntries(TOKENS.map((name) => [name, `token-in-${name}`]));
    const env = { ...process.env, ...tokens, TAKEN: taken, PATH: `${scratch.path}${delimiter}${process.env.PATH ?? ""}` };

    const ran = Bun.spawnSync([process.execPath, "-e", PROGRAM, CODE], { env, stdout: "pipe", stderr: "pipe" });
    if (ran.exitCode !== 0) throw new Error(`the copy exited ${ran.exitCode}: ${ran.stderr.toString()}`);

    expect([ran.stdout.toString().trim(), readFileSync(taken, "utf8")]).toEqual(["true", `${CODE}|${TOKENS.map(() => "").join("|")}|\n`]);
  });
});
