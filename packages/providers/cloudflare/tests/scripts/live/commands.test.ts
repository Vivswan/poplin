// The product's own commands, run in this process as the live harness runs them, against a fake Cloudflare account in memory.
// A command that took a published release would install another build than the commit's, and a run that read its value wrong would mend or remove on a guess.

import { describe, expect, test } from "bun:test";

import { OWN_SCHEMA } from "../../../../../core/src/database/open";
import { command, placeWords, publish, reachOf } from "../../../scripts/live/commands";
import { type Found, openRun } from "../../../scripts/live/util";
import { MAP_FILE, MODULE_FILE } from "../../../src/shared/release/publish/bundle-manifest";
import { projectReleases } from "../../../src/shared/release/publish/release-source";
import { checkedBundle } from "../../../src/shared/release/update/bundle-files";
import { ACCOUNT, TOKEN } from "../../shared/install/support/fake-install";
import { ADDRESSES, LAYOUT } from "../../shared/install/support/layouts";
import { COMMIT, freshAccount, harnessOf, LOGIN } from "../../live/support/harness-world";
import { catchStep } from "../../live/support/step";

/** The install of each kind, as a run finds it on the fake account, with what a removal of it is confirmed by. */
const FOUND = {
  domain: { found: { kind: "domain", zone: { id: "zone-1", name: "example.com", plan: "free", accountId: ACCOUNT }, layout: LAYOUT, adminHost: LAYOUT.adminHostname }, confirm: "poplin.example.com" },
  "account address": { found: { kind: "account address", zone: undefined, layout: ADDRESSES, adminHost: ADDRESSES.adminHost }, confirm: "poplin.example.workers.dev" },
} as const satisfies Record<Found["kind"], { readonly found: Found; readonly confirm: string }>;

/** The repository's own Worker configuration, which a build's manifest is written from. */
const CONFIG: unknown = Bun.JSONC.parse(await Bun.file(`${import.meta.dir}/../../../../../../wrangler.jsonc`).text());

/** A build of the Worker, as any bytes. */
const BUILT = { version: COMMIT, config: CONFIG, files: { [MODULE_FILE]: new TextEncoder().encode("the module"), [MAP_FILE]: new TextEncoder().encode("{}") } };

/** The states of the rows of a command, each once, in the order they first come. */
function statesOf(answer: Awaited<ReturnType<typeof command>>): readonly string[] {
  return answer.kind === "rows" ? [...new Set(answer.rows.map((row) => row.state))] : [answer.kind];
}

describe("this commit's build, answered where the product asks for a release", () => {
  // Drift: the product reads releases from a fixed address. A stand-in at any other address would let a command reach the real website and install what is published there.
  test("the product's own readers find the build as the one release, with every digest matching, and each other request goes out as it is", async () => {
    const passed: string[] = [];
    const reach = reachOf(await publish(BUILT), async (input) => {
      passed.push(String(input));

      return new Response("passed on");
    });
    const pins = await projectReleases({ fetch: (url, init) => reach.fetch(url, init) }).pins();
    const pin = pins?.[COMMIT];
    const checked = pin === undefined ? undefined : await checkedBundle({ fetch: (url, init) => reach.fetch(url, init) }, COMMIT, pin);
    const other = await (await reach.fetch("https://api.cloudflare.com/client/v4/accounts")).text();

    expect({ versions: Object.keys(pins ?? {}), schema: pin?.schema, taken: checked?.ok === true && new TextDecoder().decode(checked.bundle.module), other, passed }).toEqual({
      versions: [COMMIT],
      schema: OWN_SCHEMA,
      taken: "the module",
      other: "passed on",
      passed: ["https://api.cloudflare.com/client/v4/accounts"],
    });
  });
});

describe.each(["domain", "account address"] as const)("the commands of an install on its %s, each run as a person's run that asks nothing", (kind) => {
  const { found, confirm } = FOUND[kind];

  // Drift: the harness decides by these answers alone whether it installs, mends, or removes. A value read wrong would mend an account with no install, or remove with a proof the command refuses.
  test("install makes it and then finds it there with the commit's version; the repair leaves it; the removal's dry run names its proof, and the removal with that proof takes it away", async () => {
    using _step = catchStep();
    const { run, world, lines } = await harnessOf(freshAccount(), kind);
    // A run hides the names of its place where it finds them, before its first command.
    for (const name of ["example.com", "example.workers.dev"]) run.hide(name);

    const place = placeWords(run, found);
    const install = ["cloudflare", ...place, `--login=${LOGIN}`, "--yes", "--adopt", "--no-log-in", "--json"];
    const made = await command(run, "install", install, world.ends);
    const there = await command(run, "install", install, world.ends);
    const mended = await command(run, "repair", ["--repair", ...place, "--yes", "--json"], world.ends);
    const listed = await command(run, "uninstall", ["cloudflare", ...place, "--json", "--dry-run"], world.ends);
    const removed = await command(run, "uninstall", ["cloudflare", ...place, "--json", `--confirm=${confirm}`], world.ends);
    const gone = await command(run, "uninstall", ["cloudflare", ...place, "--json", "--dry-run"], world.ends);

    expect({ made: statesOf(made).filter((state) => state !== "leave"), there, mended: statesOf(mended) }).toEqual({
      made: kind === "domain" ? ["make", "change"] : ["make"],
      there: { kind: "stopped", problem: "already_installed", version: COMMIT },
      mended: ["leave"],
    });
    expect({ listed: listed.kind === "rows" && listed.confirm, removed: statesOf(removed), gone }).toEqual({ listed: confirm, removed: ["remove", "stay"], gone: { kind: "stopped", problem: "no_install", version: undefined } });
    // The command's own lines beside its value went to the log, with the token and every hidden name taken out.
    expect({ said: lines.length > 0, named: [TOKEN, ACCOUNT, "example.com", "example.workers.dev"].filter((name) => lines.join("\n").includes(name)) }).toEqual({ said: true, named: [] });
  });

  // Drift: a command names the next command at the install's place, so a line of it holds the zone's name after `--domain`. Printed as it came on any path, it would put the name of the test zone in a public log.
  test("a line that names the next command at the install's place is printed with the place's name hidden: as a plain line, beside the one value, and as an annotation; the value itself is never printed", async () => {
    using step = catchStep();
    const { run, world } = await harnessOf(freshAccount(), kind);
    const opened = openRun({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
    const names = ["example.com", "example.workers.dev"];
    for (const name of names) opened.hide(name);

    // The run prints as a run of the harness does, so what reaches the log here is what reaches it there.
    const live = { ...run, say: opened.say, annotate: opened.annotate };
    const repair = ["--repair", ...placeWords(run, found), "--yes"];
    await command(live, "repair", repair, world.ends);
    await command(live, "repair", [...repair, "--json"], world.ends);
    live.annotate("error", `The repair stopped: npx poplin install cloudflare ${kind === "domain" ? "--domain example.com" : "--no-domain"}, at https://${found.adminHost}`);

    const printed = step.lines.filter((line) => !line.startsWith("::add-mask::"));
    const next = `npx poplin install cloudflare ${kind === "domain" ? "--domain [hidden]" : "--no-domain"}`;

    expect({ told: printed.filter((line) => line.includes("npx poplin")), named: names.filter((name) => printed.join("\n").includes(name)), value: printed.some((line) => line.includes('"next"')) }).toEqual({
      told: [`No install is in this account. To make one: ${next}`, `No install is in this account. To make one: ${next}`, `::error::The repair stopped: ${next}, at https://poplin.[hidden]`],
      named: [],
      value: false,
    });
  });

  test("a line the command refuses is a stop with its problem's code, and a command that prints no JSON value is told apart from both", async () => {
    using _step = catchStep();
    const { run, world } = await harnessOf(freshAccount(), kind);
    const lacking = await command(run, "install", ["cloudflare", ...placeWords(run, found), "--yes", "--json"], world.ends);
    const plain = await command(run, "install", ["cloudflare", ...placeWords(run, found), "--yes"], world.ends);

    expect([lacking, plain]).toEqual([
      { kind: "stopped", problem: "missing_answer", version: undefined },
      { kind: "unread", code: 2 },
    ]);
  });
});
