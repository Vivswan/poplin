// The data of what went wrong: the problems of the last days for the Usage screen, and what the frame marks at the side.
//
//   GET /problems   ?days= how many UTC days back, today included: 7 or 30
//
// Each problem carries its words and the screen where it is acted on, so no client holds a second copy of either.

import { vValidator } from "@hono/valibot-validator";
import { listProblems } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { PROBLEM_WORDS, type Problem } from "@poplin/core/src/records/problem";
import { Hono } from "hono";
import * as v from "valibot";

import { refused, refuseInvalid, type Shared } from "./data";

/** The stretches of days the list offers, the shortest first. */
const RANGES = ["7", "30"] as const;

/** What the list's address may ask for, and nothing else. */
const PROBLEMS_QUERY = v.strictObject({ days: v.pipe(v.picklist(RANGES), v.transform(Number)) });

/** How far back a problem still marks its screen at the side, in milliseconds: a day. */
const MARKED_MS = 86_400_000;

/** How many UTC days hold every moment of the last day: today and yesterday. */
const MARKED_DAYS = 2;

/** The screens a problem can belong to. */
type Home = (typeof PROBLEM_WORDS)[keyof typeof PROBLEM_WORDS]["home"];

/** A problem as a screen shows it: the record, its sentence, what to do, the screen where it is acted on, and the setting that holds the limit it is about. */
type ShownProblem = Problem & (typeof PROBLEM_WORDS)[keyof typeof PROBLEM_WORDS];

/** What the side marks at one screen: how many problems, and the sentence of the first. */
interface Mark {
  readonly count: number;
  readonly says: string;
}

/** What the frame holds of the problems: each kind last seen within a day, once, the newest first, and the mark of each screen that has any. */
export interface Marked {
  readonly recent: readonly ShownProblem[];
  readonly marks: Readonly<Record<Home, Mark | null>>;
}

/** The frame of an install with no problem. */
export const NOTHING_MARKED: Marked = { recent: [], marks: { usage: null, domain: null, settings: null } };

/** A problem with its words. In a console with no Domain screen a problem of the domain is acted on nowhere, so it belongs to the list on Usage. */
function shown(problem: Problem, domain: boolean): ShownProblem {
  const words = PROBLEM_WORDS[problem.kind];

  return { ...problem, ...words, home: words.home === "domain" && !domain ? "usage" : words.home };
}

/** The mark of one screen: its problems, and before them what else the screen must act on. */
function markOf(home: Home, recent: readonly ShownProblem[], also: readonly string[]): Mark | null {
  const says = [...also, ...recent.filter((problem) => problem.home === home).map((problem) => problem.sentence)];
  const [first] = says;

  return first === undefined ? null : { count: says.length, says: first };
}

/**
 * Read what the frame marks: the problems last seen within a day, and the count of each screen. It is one read of the database.
 *
 * @param domain - whether the console has a Domain screen, and the sentence of what the domain needs, where it is an alarm: it marks the Domain screen as a problem there does, so one rule decides the mark
 * @returns nothing marked for anyone but an admin
 */
export async function markedOf(install: Pick<Install, "database" | "now">, actor: Actor, domain: { readonly screen: boolean; readonly says: string | null }): Promise<Marked> {
  const listed = await listProblems(install, actor, MARKED_DAYS);
  const since = install.now() - MARKED_MS;
  const seen = listed.ok ? listed.problems.filter((problem) => problem.last_at > since) : [];
  // A kind seen on both sides of midnight is one problem: its newest day stands for it.
  const recent = seen.filter((problem, at) => seen.findIndex((one) => one.kind === problem.kind) === at).map((problem) => shown(problem, domain.screen));
  const also = { usage: [], settings: [], domain: domain.says === null ? [] : [domain.says] };

  return { recent, marks: { usage: markOf("usage", recent, also.usage), domain: markOf("domain", recent, also.domain), settings: markOf("settings", recent, also.settings) } };
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
