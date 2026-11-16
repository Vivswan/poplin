// The release gate's reading of the live upgrade runs against a `gh` a test answers for.
// Without it a run that ended green with its upgrade skipped, or an upgrade of one kind of install alone, would let a release through that no real install was updated to.

import { describe, expect, test } from "bun:test";

import { proveUpgrades } from "../../../scripts/upgrade/proof";

/** The commit of main the release stands on, as the comparison of the two tips names it. */
const STANDS_ON = "c".repeat(40);

/** The runs of each kind's workflow for that commit, and how the job `upgrade` of each run ended. `base` is what the comparison names, and `silent` the workflow whose runs GitHub does not list. */
interface Hub {
  readonly domain: Readonly<Record<string, string>>;
  readonly address: Readonly<Record<string, string>>;
  readonly base?: string | undefined;
  readonly silent?: string | undefined;
}

/** The questions of a commit's green runs by hand, as each workflow is asked them. */
const RUNS_OF = /\/workflows\/(live-checks(?:-account-address)?\.yml)\/runs\?event=workflow_dispatch&branch=main&head_sha=(\w+)&status=success&/;

/** The question of one run's jobs. */
const JOBS_OF = /\/actions\/runs\/(\d+)\/jobs/;

/** The green runs by hand one workflow is asked for: none for another commit, and no answer for the workflow a hub is silent on. */
function runsOf(hub: Hub, file: string, sha: string | undefined): string | undefined {
  if (file === hub.silent) return undefined;

  return sha === STANDS_ON ? Object.keys(file === "live-checks.yml" ? hub.domain : hub.address).join("\n") : "";
}

/** Answer `gh` from a hub: the comparison, the green runs by hand of one workflow for the commit, and the upgrade's job of one run. */
function ghOf(hub: Hub): (args: readonly string[]) => Promise<string | undefined> {
  const ended: Readonly<Record<string, string>> = { ...hub.domain, ...hub.address };

  return async (args) => {
    const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (path.endsWith("/compare/base-tip...head-tip")) return hub.base;

    const [, file, sha] = RUNS_OF.exec(path) ?? [];
    if (file !== undefined) return runsOf(hub, file, sha);

    const [, run] = JOBS_OF.exec(path) ?? [];

    return run === undefined ? undefined : `${ended[run] ?? ""}\n`;
  };
}

/** The error of a kind with no green upgrade. */
function lacking(kind: string, workflow: string): string {
  return `::error::no green live upgrade of an install ${kind} for ${STANDS_ON}: run the workflow "${workflow}" by hand on main with \`upgrade\` ticked, then run this job again`;
}

describe("the release gate's reading of the live upgrade", () => {
  test.each([
    [
      "both kinds upgraded green, one in a later run than a run without the upgrade",
      { domain: { "11": "skipped", "12": "success" }, address: { "21": "success" }, base: `${STANDS_ON}\n` },
      { code: 0, lines: [`upgrade of an install with a domain: green in run 12 of ${STANDS_ON}`, `upgrade of an install without a domain: green in run 21 of ${STANDS_ON}`] },
    ],
    [
      "a green run whose upgrade was skipped, and no run of the other kind",
      { domain: { "11": "skipped" }, address: {}, base: STANDS_ON },
      { code: 1, lines: [lacking("with a domain", "Live Checks"), lacking("without a domain", "Live Checks (account address)")] },
    ],
    [
      "one kind alone",
      { domain: { "12": "success" }, address: { "21": "failure" }, base: STANDS_ON },
      { code: 1, lines: [`upgrade of an install with a domain: green in run 12 of ${STANDS_ON}`, lacking("without a domain", "Live Checks (account address)")] },
    ],
    [
      "a GitHub that does not list the runs of one kind",
      { domain: { "12": "success" }, address: { "21": "success" }, base: STANDS_ON, silent: "live-checks-account-address.yml" },
      { code: 1, lines: [`upgrade of an install with a domain: green in run 12 of ${STANDS_ON}`, `::error::GitHub did not say whether an install without a domain was upgraded for ${STANDS_ON}: run this job again`] },
    ],
    ["a GitHub that does not say which commit the release stands on", { domain: { "12": "success" }, address: { "21": "success" } }, { code: 1, lines: ["::error::GitHub did not say which commit of main the release stands on"] }],
  ] as const)("%s", async (_what, hub, ending) => {
    expect(await proveUpgrades({ repository: "example/poplin", base: "base-tip", head: "head-tip", gh: ghOf(hub) })).toEqual({ code: ending.code, lines: [...ending.lines] });
  });
});
