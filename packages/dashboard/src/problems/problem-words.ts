// The words of a problem on every screen that shows one: how often it came, where it is acted on, and the text a person copies into a report.

import { BOOT } from "@/lib/boot";
import { momentIn } from "@/lib/timezone";
import type { Problem } from "@/problems/problems-queries";

/** The screens a problem is acted on, each with its path and its name. A problem of the Usage screen is acted on where the list is, so it names no other place. */
export const HOMES = {
  usage: { to: "/usage", label: "Usage" },
  domain: { to: "/domain", label: "Domain" },
  settings: { to: "/settings", label: "Settings" },
} as const;

/** The key of the address that holds the problem whose panel is open. */
export const PROBLEM_KEY = "problem";

/**
 * What names one problem in an address: its day and its kind.
 */
export function problemId(problem: Pick<Problem, "day" | "kind">): string {
  return `${problem.day}.${problem.kind}`;
}

/**
 * How often a problem came, in words: `once`, `3 times`, or `12+ times` where it came more often than it was written down.
 */
export function howOften(problem: Pick<Problem, "count" | "more">): string {
  if (problem.count === 1 && !problem.more) return "once";

  return `${problem.count}${problem.more ? "+" : ""} times`;
}

/**
 * How many problems a screen holds, as the mark at its section is named: `1 problem`, `2 problems`.
 */
export function problemCount(count: number): string {
  return count === 1 ? "1 problem" : `${count} problems`;
}

/**
 * The text of a problem for a report: its kind, its times in UTC, how often, the version, and the failure's name and cleaned message. Nothing of a request is in it.
 */
export function detailsOf(problem: Problem): string {
  const failure = [problem.name, problem.message].filter((part) => part !== null).join(": ");

  return [
    `poplin ${BOOT.version}: ${problem.kind}`,
    problem.sentence,
    `First: ${momentIn(problem.first_at, "utc")}`,
    `Last: ${momentIn(problem.last_at, "utc")}`,
    `How often: ${howOften(problem)}`,
    ...(failure === "" ? [] : [`Failure: ${failure}`]),
  ].join("\n");
}
