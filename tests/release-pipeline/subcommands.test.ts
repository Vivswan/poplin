/**
 * The subcommands as a workflow step runs them, against a checkout, a registry on a local port, and a scripted npm:
 * what would drift silently is which folder npm runs in, what a step prints and exits with, and what it refuses.
 */

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { type Answer, type Checkout, record, SOURCE_DATE, type StepResult, shallowClone, subcommand, withCheckout, withNpm, withRegistry } from "./fixture.js";

/** The OIDC request URL a step is given: without one a publish is refused. */
const OIDC = "https://oidc.example.com/token";

/** The step's environment: the source commit, the local registry, the scripted npm, no pause between reads. */
const stepEnv = (checkout: Checkout, url: string, path: string): Record<string, string> => ({
  GITHUB_SHA: checkout.source,
  ACTIONS_ID_TOKEN_REQUEST_URL: OIDC,
  NPM_REGISTRY_URL: url,
  NPM_CONFIRM_PAUSE_MS: "0",
  PATH: path,
});

/** The version the source commit mints from a 0.3.0 manifest: second along main's first parents (fourth by plain count), dated in UTC. */
const own = (checkout: Checkout): string => `0.3.1-main.2.${SOURCE_DATE}.g${checkout.source.slice(0, 7)}`;

/** The npm calls a next publish makes, as the scripted npm prints them. */
const nextCalls = (checkout: Checkout): string[] => [
  `npm pkg set version=${own(checkout)} (in packages/cli, GITHUB_SHA=${checkout.source})`,
  `npm publish --tag next (in packages/cli, GITHUB_SHA=${checkout.source})`,
];

/** A step's whole stdout or stderr: the tests compare it complete, final newline included. */
const lines = (...each: string[]): string => each.map((line) => `${line}\n`).join("");

// A dozen git and bun spawns per test pass bun's 5 s default on a loaded machine.
setDefaultTimeout(60_000);

describe("npm-publish next", () => {
  test("publishes from packages/cli under next, then reads the registry past its cache until the version shows", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const unresolved = "0.3.1-main.9.20260901.g0000000";
      const judged = record(["0.3.0", unresolved], { latest: "0.3.0", next: unresolved });
      const shown = record(["0.3.0", own(checkout)], { latest: "0.3.0", next: own(checkout) });
      const answers = [{ status: 200, body: judged }, { status: 404 }, { status: 200, body: shown }];

      const result = await withNpm({}, (path) =>
        withRegistry(answers, async (url, requests) => ({ step: await subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next"), requests })),
      );

      expect(result.step).toEqual({
        stdout: lines(...nextCalls(checkout), `::notice::${own(checkout)} is on the registry after 2 reads; next is not behind a descendant's pre-release`),
        stderr: lines(`${unresolved} names 0000000, which is no commit in this checkout; ignored`),
        status: 0,
      });
      expect(result.requests).toHaveLength(3);
      expect(new Set(result.requests).size).toBe(3);
      for (const request of result.requests) {
        expect(request).toMatch(/^\/poplin\?fresh=\d+-[0-9a-z]+$/);
      }
    });
  });

  test.each<[string, (checkout: Checkout) => { versions: string[]; next: string; reason: string }]>([
    [
      "a rerun whose version the record holds",
      (checkout) => ({ versions: [own(checkout)], next: own(checkout), reason: `${own(checkout)} is already on the registry` }),
    ],
    [
      "a stale run behind a descendant's pre-release",
      (checkout) => {
        const ahead = `0.3.1-main.3.20260915.g${checkout.after.slice(0, 7)}`;
        const reason =
          `the registry already holds ${ahead}, whose source ${checkout.after.slice(0, 7)} is a descendant of ${checkout.source.slice(0, 7)} on main, ` +
          "so this stale run publishes nothing (npm publish --tag next would move next back)";
        return { versions: [ahead], next: ahead, reason };
      },
    ],
  ])("%s calls npm not at all and raises a notice", async (_name, state) => {
    await withCheckout("0.3.0", async (checkout) => {
      const { versions, next, reason } = state(checkout);
      const answers = [{ status: 200, body: record(["0.3.0", ...versions], { latest: "0.3.0", next }) }];

      const result = await withNpm({}, (path, calls) =>
        withRegistry(answers, async (url) => ({ step: await subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next"), calls: calls() })),
      );

      expect(result).toEqual({ step: { stdout: lines(`::notice::${reason}`), stderr: "", status: 0 }, calls: [] });
    });
  });

  test("a pre-release naming a commit off main is set aside with a notice, placed by the checkout's own history", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const side7 = checkout.side.slice(0, 7);
      const unrelated = `0.3.1-main.2.20260913.g${side7}`;
      const judged = record(["0.3.0", unrelated], { latest: "0.3.0", next: unrelated });
      const shown = record(["0.3.0", unrelated, own(checkout)], { latest: "0.3.0", next: own(checkout) });
      const answers = [{ status: 200, body: judged }, { status: 200, body: shown }];

      const step = await withNpm({}, (path) => withRegistry(answers, (url) => subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next")));

      expect(step).toEqual({
        stdout: lines(...nextCalls(checkout), `::notice::${own(checkout)} is on the registry after 1 read; next is not behind a descendant's pre-release`),
        stderr: lines(`${unrelated} names ${side7}, which is neither an ancestor nor a descendant of ${checkout.source.slice(0, 7)} on main; ignored`),
        status: 0,
      });
    });
  });
});

describe("npm-publish next, once npm has run", () => {
  test("a record that never shows the version within the bound warns, and the step passes", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const result = await withNpm({}, (path) =>
        withRegistry([{ status: 404 }], async (url, requests) => ({ step: await subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next"), requests })),
      );

      expect(result.step).toEqual({
        stdout: lines(
          ...nextCalls(checkout),
          `::warning::the registry's record still lacks ${own(checkout)} after 15 reads over 0 s; a run judged before it shows may move next back, and the push to main after it moves next forward`,
        ),
        stderr: "",
        status: 0,
      });
      expect(result.requests).toHaveLength(16);
    });
  });

  test("next left behind a descendant's pre-release fails the step with the drift named, after the publish", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const after7 = checkout.after.slice(0, 7);
      const ahead = `0.3.1-main.3.20260915.g${after7}`;
      const drifted = record(["0.3.0", ahead, own(checkout)], { latest: "0.3.0", next: own(checkout) });
      const answers = [{ status: 404 }, { status: 200, body: drifted }];

      const step = await withNpm({}, (path) => withRegistry(answers, (url) => subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next")));

      expect(step).toEqual({
        stdout: lines(
          ...nextCalls(checkout),
          `::error::the registry's next is ${own(checkout)} while it holds ${ahead}, whose source ${after7} is a descendant of ${checkout.source.slice(0, 7)} on main; ` +
            `a stale run moved next back, and the next push to main moves it forward (npm dist-tag add poplin@${ahead} next repairs it by hand)`,
        ),
        stderr: "",
        status: 1,
      });
    });
  });

  test("an npm publish that fails ends the step with its status named, and the registry is not read again", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const result = await withNpm({ failing: { command: "publish", status: 3 } }, (path) =>
        withRegistry([{ status: 404 }], async (url, requests) => ({ step: await subcommand(checkout.work, stepEnv(checkout, url, path), "npm-publish", "next"), requests })),
      );

      expect(result.step).toEqual({
        stdout: lines(...nextCalls(checkout)),
        stderr: lines("release-pipeline npm-publish: npm publish --tag next exited 3; see npm's output above."),
        status: 1,
      });
      expect(result.requests).toHaveLength(1);
    });
  });
});

describe("npm-publish stable", () => {
  const stable = (checkout: Checkout, url: string, path: string, tag: string): Promise<StepResult> =>
    subcommand(checkout.work, { ...stepEnv(checkout, url, path), TAG: tag }, "npm-publish", "stable");

  test.each<[string, Answer[], (checkout: Checkout) => string[], number]>([
    [
      "publishes package.json's version from packages/cli under the default dist-tag, then waits for it to show",
      [{ status: 404 }, { status: 200, body: record(["0.3.0"], { latest: "0.3.0" }) }],
      (checkout) => [`npm publish (in packages/cli, GITHUB_SHA=${checkout.source})`, "::notice::0.3.0 is on the registry after 1 read"],
      2,
    ],
    ["a rerun whose version the record holds calls npm not at all and warns", [{ status: 200, body: record(["0.3.0"], { latest: "0.3.0" }) }], () => ["::warning::0.3.0 is already on the registry"], 1],
    [
      "a rerun of an older release after a newer one holds latest calls npm not at all and warns",
      [{ status: 200, body: record(["0.2.0", "0.4.0"], { latest: "0.4.0" }) }],
      () => ["::warning::the registry's latest is 0.4.0, newer than 0.3.0, so this rerun of an older release publishes nothing (npm publish would move latest back)"],
      1,
    ],
  ])("%s", async (_name, answers, stdout, reads) => {
    await withCheckout("0.3.0", async (checkout) => {
      const result = await withNpm({}, (path) => withRegistry(answers, async (url, requests) => ({ step: await stable(checkout, url, path, "v0.3.0"), requests })));

      expect(result.step).toEqual({ stdout: lines(...stdout(checkout)), stderr: "", status: 0 });
      expect(result.requests).toHaveLength(reads);
    });
  });
});

describe("a refusal comes before the registry is read or npm runs", () => {
  interface Refusal {
    args: string[];
    env: Record<string, string>;
    stderr: (checkout: Checkout) => string;
  }

  test.each<[string, Refusal]>([
    [
      "no OIDC request URL: publishing is trusted publishing alone",
      {
        args: ["npm-publish", "next"],
        env: { ACTIONS_ID_TOKEN_REQUEST_URL: "" },
        stderr: () =>
          "release-pipeline npm-publish: ACTIONS_ID_TOKEN_REQUEST_URL is not set, so this job has no OIDC token: npm trusted publishing is the only way this pipeline publishes, and no npm token is read. Grant the job id-token: write.",
      },
    ],
    [
      "a release tag that is not package.json's version",
      {
        args: ["npm-publish", "stable"],
        env: { TAG: "v0.4.0" },
        stderr: () =>
          "release-pipeline npm-publish: package.json at the release source is version 0.3.0, but the release tag is v0.4.0; refusing to publish a version this source did not release.",
      },
    ],
    ["a release without its tag", { args: ["npm-publish", "stable"], env: {}, stderr: () => "release-pipeline npm-publish: TAG must be set for this step" }],
    [
      "a checkout at another commit than the source",
      {
        args: ["npm-publish", "next"],
        env: { GITHUB_SHA: "f".repeat(40) },
        stderr: (checkout) => `release-pipeline npm-publish: the checkout is at ${checkout.source}, not the source commit ${"f".repeat(40)} whose build is published.`,
      },
    ],
    ["no channel", { args: ["npm-publish"], env: {}, stderr: () => "release-pipeline npm-publish: npm-publish takes the channel, next or stable, not null" }],
    [
      "a pause that is not a whole number of milliseconds",
      {
        args: ["npm-publish", "next"],
        env: { NPM_CONFIRM_PAUSE_MS: "soon" },
        stderr: () => 'release-pipeline npm-publish: NPM_CONFIRM_PAUSE_MS must be a whole number of milliseconds, not "soon"',
      },
    ],
    ["an unknown subcommand", { args: ["publish"], env: {}, stderr: () => 'release-pipeline: unknown command "publish"; expected npm-floor | prerelease-version | npm-publish' }],
  ])("%s", async (_name, refusal) => {
    await withCheckout("0.3.0", async (checkout) => {
      const result = await withNpm({}, (path, calls) =>
        withRegistry([{ status: 404 }], async (url, requests) => ({
          step: await subcommand(checkout.work, { ...stepEnv(checkout, url, path), ...refusal.env }, ...refusal.args),
          requests,
          calls: calls(),
        })),
      );

      expect(result).toEqual({ step: { stdout: "", stderr: lines(refusal.stderr(checkout)), status: 1 }, requests: [], calls: [] });
    });
  });

  test("a shallow checkout: its commit count would stop at the boundary and sort below older commits' versions", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      const shallow = shallowClone(checkout);

      const result = await withNpm({}, (path, calls) =>
        withRegistry([{ status: 404 }], async (url, requests) => ({
          step: await subcommand(shallow.dir, { ...stepEnv(checkout, url, path), GITHUB_SHA: shallow.head }, "npm-publish", "next"),
          requests,
          calls: calls(),
        })),
      );

      expect(result).toEqual({
        step: {
          stdout: "",
          stderr: lines(
            "release-pipeline npm-publish: the pre-release version needs the full history (fetch-depth: 0) and this checkout is shallow: the count of commits under the source would stop at the shallow boundary.",
          ),
          status: 1,
        },
        requests: [],
        calls: [],
      });
    });
  });
});

describe("prerelease-version", () => {
  test("prints the version npm-publish next publishes: first-parent count, UTC date, g and the short sha", async () => {
    await withCheckout("0.3.0", async (checkout) => {
      expect(await subcommand(checkout.work, { GITHUB_SHA: checkout.source }, "prerelease-version")).toEqual({ stdout: lines(own(checkout)), stderr: "", status: 0 });
    });
  });
});

describe("npm-floor", () => {
  test.each<[string, string, string, number]>([
    ["at the floor", "11.5.1", "", 0],
    ["above it by a two-digit minor", "11.10.0", "", 0],
    [
      "below it",
      "10.9.2",
      "::error::npm 10.9.2 cannot publish through OIDC; trusted publishing needs npm 11.5.1 or newer. Install one in the workflow before this step.\n",
      1,
    ],
  ])("an npm %s: silent when the floor holds, an annotation when it does not, and nothing installed either way", async (_name, version, stdout, status) => {
    const result = await withNpm({ version }, async (path, calls) => ({ step: await subcommand(process.cwd(), { PATH: path }, "npm-floor"), calls: calls() }));

    expect(result).toEqual({ step: { stdout, stderr: "", status }, calls: [] });
  });
});
