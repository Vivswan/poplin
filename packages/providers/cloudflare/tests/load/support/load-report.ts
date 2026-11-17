// Shows what a load run measured, once the run ends: the full run as a page on the terminal, and any run as a Markdown file where the run names one.
//
//   the full run                       the page, printed
//   LOAD_REPORT_FILE names a file      the page, written there

import { writeFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";
import type { Profile } from "../../../load/profiles";
import { type LoadLine, loadReport, type Unfinished } from "../../../load/report";

/** A Vitest reporter that gathers the lines each scenario's test kept on itself, and shows them together: the tests run in the Workers runtime, and the page is written outside it. */
export class LoadReport implements Reporter {
  /** What the run is called. */
  readonly #profile: Profile["name"];

  /** What each scenario measured, a line a size. */
  readonly #lines: LoadLine[] = [];

  /** The scenarios whose test failed. */
  readonly #unfinished: Unfinished[] = [];

  constructor(profile: Profile["name"]) {
    this.#profile = profile;
  }

  // A watched run starts again on the same reporter: what the run before it measured is not this run's.
  onTestRunStart(): void {
    this.#lines.length = 0;
    this.#unfinished.length = 0;
  }

  onTestCaseResult(testCase: TestCase): void {
    const { load } = testCase.meta();
    if (load === undefined) return;

    this.#lines.push(...load);
    const result = testCase.result();
    if (result.state === "failed") this.#unfinished.push({ scenario: testCase.name, why: (result.errors[0]?.message ?? "").split("\n")[0] ?? "" });
  }

  onTestRunEnd(): void {
    if (this.#lines.length + this.#unfinished.length === 0) return;

    const page = loadReport(this.#profile, this.#lines, this.#unfinished);
    if (this.#profile === "full") console.log(`\n${page}`);

    const file = process.env.LOAD_REPORT_FILE ?? "";
    if (file !== "") writeFileSync(file, page);
  }
}
