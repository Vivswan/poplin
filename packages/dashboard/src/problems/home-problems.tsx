// The problems of one screen, shown where they are acted on: each as one line with its sentence, when it came, what to do, and the way to copy its details. A screen with none draws nothing.

import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFrame } from "@/lib/frame";
import { CopyDetails, ProblemTodo, ProblemWhen } from "@/problems/problem-facts";
import { type HOMES, problemId } from "@/problems/problem-words";

/**
 * Draw the problems last seen within a day that belong to one screen.
 *
 * @param home - the screen that draws them
 */
export function HomeProblems({ home, className }: { readonly home: keyof typeof HOMES; readonly className?: string }): ReactNode {
  const here = useFrame().data.recent.filter((problem) => problem.home === home);
  if (here.length === 0) return null;

  return (
    <ul aria-label="Problems" className={className}>
      {here.map((problem) => (
        <li key={problemId(problem)}>
          <Alert role="group" aria-label={problem.sentence}>
            <TriangleAlertIcon className="text-destructive!" />
            <AlertTitle>{problem.sentence}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                <ProblemWhen problem={problem} />
              </span>
              <span className="text-foreground">
                What to do: <ProblemTodo problem={problem} />
              </span>
              <CopyDetails problem={problem} />
            </AlertDescription>
          </Alert>
        </li>
      ))}
    </ul>
  );
}
