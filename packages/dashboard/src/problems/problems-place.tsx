// Where the Usage screen draws the panel of a problem: over the end of what the screen shows, and in its place on a phone. The address holds which problem is open, so a link to it opens it again.

import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode } from "react";

import { searchOf, useAddressQuery } from "@/lib/address";
import { useFrame } from "@/lib/frame";
import { ProblemPanel } from "@/problems/problem-panel";
import { HOMES, PROBLEM_KEY, problemId } from "@/problems/problem-words";
import { useProblems, useRange } from "@/problems/problems-queries";
import { openerOf, useKeptFocus, useLiesOver } from "@/shared/side-panel";

/**
 * Draw the Usage screen's content, and over its end the panel of the problem the address names. A panel that closes gives the focus back to its row.
 *
 * @param children - what the screen shows
 */
export function ProblemsPlace({ children }: { readonly children: ReactNode }): ReactNode {
  const query = useAddressQuery();
  const opened = query.get(PROBLEM_KEY) ?? undefined;
  const { data, error } = useProblems(useRange());
  const { recent } = useFrame().data;
  const over = useLiesOver();
  const navigate = useNavigate();
  const kept = useKeptFocus(opened);
  // Until the list is read a problem of the frame stands in for it. Once it is read, the list alone says whether the problem is there.
  const problem = (data?.problems ?? recent).find((one) => problemId(one) === opened);
  const closed = new URLSearchParams(query);
  closed.delete(PROBLEM_KEY);
  const toList = { to: HOMES.usage.to, search: searchOf(closed) } as const;

  return (
    <div {...kept} className="relative grid min-h-0 flex-1 grid-cols-1">
      {/* The screen keeps its width under an open panel. Where the panel has the row to itself the screen is out of sight and out of reach, and is found as it was left. */}
      <div className={cn("col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", opened !== undefined && !over && "invisible")}>{children}</div>
      {opened === undefined ? null : (
        <ProblemPanel
          key={opened}
          problem={problem}
          read={data !== undefined}
          failure={error?.message}
          closeLink={<Link {...toList} />}
          onClose={() => void navigate(toList)}
          opener={() => openerOf(opened)}
        />
      )}
    </div>
  );
}
