// The script that makes the test install runs against a local fake of the Cloudflare API, and the workflow is read beside it.
// A run that stopped before it made anything once ended green with an empty log.

import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { convergeInstall } from "../../packages/cloudflare/scripts/live/converge";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { type Asked, page, refusal, reply, withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";

/** The workflow that runs the live scripts. */
const WORKFLOW = join(import.meta.dir, "..", "..", ".github", "workflows", "live-checks.yml");

/** A step's output as a workflow expression names it: the step's id, then the output's name. */
const OUTPUT_READ = /steps\.([\w-]+)\.outputs\.([\w-]+)/g;

/** The id of the workflow step that runs the script. */
const CONVERGE_STEP = "converge";

/** The account the fake holds. */
const ACCOUNT = "0".repeat(32);

/** The zone of a fake account that has one. */
const ZONE = { id: "1".repeat(32), name: "example.com", account: { id: ACCOUNT }, plan: { name: "Free Website" } };

/** What the fake account holds, and which lists its token may read. A list that is absent is refused. */
interface FakeAccount {
  readonly zones?: readonly (typeof ZONE)[];
  readonly buckets?: readonly string[];
}

/** One fake account, and what a run on it tells: the lines of the log in order, and the reason the summary and the error line give. */
type Case = readonly [what: string, account: FakeAccount, lines: readonly string[], reason: string];

/** What one run of the script left behind. */
interface Told {
  readonly code: number;
  readonly lines: string[];
  readonly summary: string;
  readonly outputs: string[];
}

const CASES: readonly Case[] = [
  ["a token that may not read the zones stops the run with the permission it needs", {}, [], "it needs the token permission Zone: Read"],
  [
    "an account with no zone stops the run with what it needs",
    { zones: [] },
    [],
    "it needs exactly one zone in the account, or the zone's name in CLOUDFLARE_ZONE_NAME",
  ],
  [
    "a run that stops at the database has told of the zone and the bucket before it",
    { zones: [ZONE], buckets: ["poplin-live-sites"] },
    ["Zone: found", "R2 bucket: present"],
    "it needs the token permission D1: Edit",
  ],
];

/** Answer for the fake account: its zones, its buckets, and a refusal of anything its token may not read. */
function answer(account: FakeAccount, asked: Asked): Response {
  const { pathname } = new URL(asked.path, "http://localhost");
  if (pathname === "/zones" && account.zones !== undefined) return page(asked, account.zones);

  if (pathname === `/accounts/${ACCOUNT}/r2/buckets` && asked.method === "GET" && account.buckets !== undefined) {
    return reply({ buckets: account.buckets.map((name) => ({ name })) });
  }

  return refusal(403, 10000, "Authentication error");
}

/** Run the script on a fake account, with the log, the step summary, and the step's outputs caught. */
async function converge(account: FakeAccount): Promise<Told> {
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-selftest-"));
  using log = spyOn(console, "log").mockImplementation(() => undefined);
  const env = {
    CLOUDFLARE_API_TOKEN: "a-made-up-token",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    GITHUB_STEP_SUMMARY: join(folder.path, "summary.md"),
    GITHUB_OUTPUT: join(folder.path, "output"),
  };
  let code = 0;

  await withFake(
    (asked) => answer(account, asked),
    async (connection) => {
      code = await convergeInstall({ ...openRun(env), connection }, env);
    },
  );

  const lines = log.mock.calls.map(([line]) => String(line)).filter((line) => !line.startsWith("::add-mask::"));
  const outputs = readFileSync(env.GITHUB_OUTPUT, "utf8")
    .split("\n")
    .flatMap((line) => (line === "" ? [] : [line.slice(0, line.indexOf("="))]));

  return { code, lines, summary: readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), outputs };
}

/** Every string a parsed document holds, at any depth. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (typeof value !== "object" || value === null) return [];

  return Object.values(value).flatMap(stringsOf);
}

describe("the script that makes the test install, against a local fake account", () => {
  test.each(CASES)("%s", async (_what, account, lines, reason) => {
    const told = await converge(account);
    const sentence = `The test install could not be made ready: ${reason}.`;

    expect({ code: told.code, lines: told.lines }).toEqual({ code: 1, lines: [...lines, `::error::${sentence}`] });
    expect(told.summary).toContain(`**${sentence}**`);
    // The zone's name is hidden before anything is written.
    expect(told.summary).not.toContain(ZONE.name);
  });

  test("every step output the workflow reads is one the script writes, even on a run that stopped", async () => {
    const told = await converge({ zones: [ZONE], buckets: [] });
    const written = told.outputs.map((output) => `${CONVERGE_STEP}.${output}`);
    const workflow: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8"));
    const read = stringsOf(workflow).flatMap((text) => [...text.matchAll(OUTPUT_READ)].map((match) => `${match[1]}.${match[2]}`));

    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((name) => !written.includes(name))).toEqual([]);
  });
});
