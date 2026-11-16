// What every showing of one problem says under its sentence: when it came, how often, what to do, and the way to copy its details. The panel of the Usage screen and the line on a problem's own screen both draw it.

import { CopyIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/notify";
import { momentIn, useChosenTimeZone } from "@/lib/timezone";
import { detailsOf, type HOMES, howOften, todoAt } from "@/problems/problem-words";
import type { Problem } from "@/problems/problems-queries";

/** What a copy says when it worked, and when the browser copies nothing. */
const COPIED = { done: "Details copied.", failed: "Not copied. The browser did not allow it." } as const;

/**
 * When a problem came and how often, in one line: `15 Nov 2026, 14:02. Once.` or `First 15 Nov 2026, 13:32, last 15 Nov 2026, 14:02. 12+ times.`
 */
export function ProblemWhen({ problem }: { readonly problem: Problem }): ReactNode {
  useChosenTimeZone();
  const often = howOften(problem);
  const said = `${often.slice(0, 1).toUpperCase()}${often.slice(1)}.`;
  if (problem.first_at === problem.last_at) return `${momentIn(problem.last_at)}. ${said}`;

  return `First ${momentIn(problem.first_at)}, last ${momentIn(problem.last_at)}. ${said}`;
}

/**
 * What to do about a problem. A command in it stands out as one.
 *
 * @param here - the screen that draws it, where that is one a problem is acted on: its own problems then do not lead to it
 */
export function ProblemTodo({ problem, here }: { readonly problem: Problem; readonly here?: keyof typeof HOMES }): ReactNode {
  return todoAt(problem, here)
    .split("`")
    .map((part, at) => (at % 2 === 1 ? <code key={part}>{part}</code> : part));
}

/** The button that copies a problem's details for a report. */
export function CopyDetails({ problem }: { readonly problem: Problem }): ReactNode {
  return (
    <Button variant="outline" size="sm" onClick={() => void copy(detailsOf(problem), COPIED)}>
      <CopyIcon data-icon="inline-start" />
      Copy the details
    </Button>
  );
}
