// The data of what went wrong: the problems of the last days for the Usage screen, and what the frame marks at the side.
//
//   GET /problems   ?days= how many UTC days back, today included: 7 or 30
//
// Each problem carries its words and the screen where it is acted on, so no client holds a second copy of either.

import { vValidator } from "@hono/valibot-validator";
import { listProblems } from "@poplin/core/src/actions/problems";
import { asksRepair, PROBLEM_WORDS, type Problem } from "@poplin/core/src/records/problem";
import { Hono } from "hono";
import * as v from "valibot";

import { refused, refuseInvalid, type Shared } from "./data";
import { type Summary, toRepair } from "./domain-answers";
import { refusalSentence } from "./notices";

/** The stretches of days the list offers, the shortest first. */
const RANGES = ["7", "30"] as const;

/** What the list's address may ask for, and nothing else. */
const PROBLEMS_QUERY = v.strictObject({ days: v.pipe(v.picklist(RANGES), v.transform(Number)) });

/** How far back a problem still marks its screen at the side, in milliseconds: a day. */
const MARKED_MS = 86_400_000;

/** The screens a problem can belong to. */
type Home = (typeof PROBLEM_WORDS)[keyof typeof PROBLEM_WORDS]["home"];

/** A problem as a screen shows it: the record, its sentence, what to do, the screen where it is acted on, and the setting that holds the limit it is about. */
type ShownProblem = Problem & (typeof PROBLEM_WORDS)[keyof typeof PROBLEM_WORDS];

/** What the side marks at one screen: how many problems, and the sentence of the first. */
interface Mark {
  readonly count: number;
  readonly says: string;
}

/**
 * What the frame holds of the problems: each kind last seen within a day, once, the newest first, and the mark of each screen that has any.
 * `domainAsks` counts those the Domain screen draws that say to press Repair, such as `1 to repair`, and is `null` for none: the screen says it over pieces that are all in place, so its line never says that nothing is left over such a problem.
 */
export interface Marked {
  readonly recent: readonly ShownProblem[];
  readonly marks: Readonly<Record<Home, Mark | null>>;
  readonly domainAsks: Summary | null;
}

/** The frame of an install with no problem. */
export const NOTHING_MARKED: Marked = { recent: [], marks: { usage: null, domain: null, settings: null }, domainAsks: null };

/** What to do about a problem. An update that was refused is kept under the refusal's code and what it is about, so its advice is that refusal's own sentence. */
function todoOf(problem: Problem): string {
  if (problem.kind !== "update_failed" || problem.name === null) return PROBLEM_WORDS[problem.kind].todo;

  return refusalSentence(problem.name, problem.message ?? undefined);
}

/** A problem with its words. In a console with no Domain screen a problem of the domain is acted on nowhere, so it belongs to the list on Usage. */
function shown(problem: Problem, domain: boolean): ShownProblem {
  const words = PROBLEM_WORDS[problem.kind];

  return { ...problem, ...words, todo: todoOf(problem), home: words.home === "domain" && !domain ? "usage" : words.home };
}

/** The mark of one screen: its problems, and before them what else the screen must act on. */
function markOf(home: Home, recent: readonly ShownProblem[], also: readonly string[]): Mark | null {
  const says = [...also, ...recent.filter((problem) => problem.home === home).map((problem) => problem.sentence)];
  const [first] = says;

  return first === undefined ? null : { count: says.length, says: first };
}

/**
 * Say what the frame marks, from the problems the frame's own read gave: those last seen within a day, and the count of each screen. It reads nothing.
 *
 * @param problems - the problems of the UTC day of `now` and of the day before, the one last seen first
 * @param domain - whether the console has a Domain screen, and the sentence of what the domain needs, where it is an alarm: it marks the Domain screen as a problem there does, so one rule decides the mark
 */
export function markedIn(problems: readonly Problem[], now: number, domain: { readonly screen: boolean; readonly says: string | null }): Marked {
  const seen = problems.filter((problem) => problem.last_at > now - MARKED_MS);
  // A kind seen on both sides of midnight is one problem: its newest day stands for it.
  const recent = seen.filter((problem, at) => seen.findIndex((one) => one.kind === problem.kind) === at).map((problem) => shown(problem, domain.screen));
  const also = { usage: [], settings: [], domain: domain.says === null ? [] : [domain.says] };
  const asking = recent.filter((problem) => problem.home === "domain" && asksRepair(problem.kind)).length;
  const marks = { usage: markOf("usage", recent, also.usage), domain: markOf("domain", recent, also.domain), settings: markOf("settings", recent, also.settings) };

  return { recent, marks, domainAsks: asking === 0 ? null : toRepair(asking) };
}

/** The data route of the problems. The newest is first. */
export const problemsRoutes = new Hono<Shared>().get("/problems", vValidator("query", PROBLEMS_QUERY, refuseInvalid), async (context) => {
  const { install, actor } = context.get("asker");
  const { days } = context.req.valid("query");
  const listed = await listProblems(install, actor, days);
  if (!listed.ok) return refused(context, listed);

  const domain = context.get("domain") !== undefined;

  return context.json({ ok: true as const, days, problems: listed.problems.map((problem) => shown(problem, domain)) });
});
