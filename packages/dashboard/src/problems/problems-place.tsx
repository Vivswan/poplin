// Where the Usage screen draws the panel of a problem: beside what the screen shows on a wide screen, and in its place on a narrower one. The address holds which problem is open, so a link to it opens it again.

import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode } from "react";

import { searchOf, useAddressQuery } from "@/lib/address";
import { useFocusHome } from "@/lib/focus";
import { useFrame } from "@/lib/frame";
import { ProblemPanel } from "@/problems/problem-panel";
import { HOMES, PROBLEM_KEY, problemId } from "@/problems/problem-words";
import { useProblems, useRange } from "@/problems/problems-queries";
import { useStandsBeside } from "@/shared/side-panel";

/**
 * Draw the Usage screen's content, and beside it the panel of the problem the address names.
 *
 * @param children - what the screen shows
 */
export function ProblemsPlace({ children }: { readonly children: ReactNode }): ReactNode {
  const query = useAddressQuery();
  const opened = query.get(PROBLEM_KEY) ?? undefined;
  const { data, error } = useProblems(useRange());
  const { recent } = useFrame().data;
  const beside = useStandsBeside();
  const navigate = useNavigate();
  const kept = useFocusHome();
  // Until the list is read a problem of the frame stands in for it. Once it is read, the list alone says whether the problem is there.
  const problem = (data?.problems ?? recent).find((one) => problemId(one) === opened);
  const closed = new URLSearchParams(query);
  closed.delete(PROBLEM_KEY);
  const toList = { to: HOMES.usage.to, search: searchOf(closed) } as const;

  return (
    <div {...kept} className={cn("grid min-h-0 flex-1 grid-cols-1", opened !== undefined && beside && "grid-cols-[minmax(0,1fr)_440px]")}>
      {/* Where the panel has the row to itself the screen keeps its place under it, out of sight and out of reach, so it is found as it was left. */}
      <div className={cn("col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", opened !== undefined && !beside && "invisible")}>{children}</div>
      {opened === undefined ? null : (
        <ProblemPanel problem={problem} read={data !== undefined} failure={error?.message} closeLink={<Link {...toList} />} onClose={() => void navigate(toList)} />
      )}
    </div>
  );
}
