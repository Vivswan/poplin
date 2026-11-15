// A section of the side with its mark: a warning sign where the section's screen holds a problem, with how many as its name and the first one's sentence as the link's hint, shown to a pointer and to the keyboard alike.
// It is the one sign of a problem that shows on every screen. On a phone the sections are behind a button, which carries the sign for all of them.

import { TriangleAlertIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFrame } from "@/lib/frame";
import { problemCount } from "@/problems/problem-words";

/** What a marked section is drawn from. */
interface MarkedSectionProps {
  /** The section's key, such as `usage`. */
  readonly section: string;

  /** The link the section is drawn as. */
  readonly link: ReactElement;

  /** The section's icon and name. */
  readonly children: ReactNode;
}

/**
 * How many problems the screens of all sections hold together: what the button that opens the sections on a phone says, where no section is in sight.
 */
export function useMarkedCount(): number {
  return Object.values(useFrame().data.marks).reduce((sum, mark) => sum + (mark?.count ?? 0), 0);
}

/** Draw a section's link, with the mark at its end where its screen holds a problem. */
export function MarkedSection({ section, link, children }: MarkedSectionProps): ReactNode {
  const { marks } = useFrame().data;
  const mark = Object.hasOwn(marks, section) ? marks[section as keyof typeof marks] : null;

  return (
    <Tooltip disabled={mark === null}>
      <TooltipTrigger render={link}>
        {children}
        {mark === null ? null : (
          <span role="img" aria-label={problemCount(mark.count)} className="ml-auto flex shrink-0 text-destructive">
            <TriangleAlertIcon className="size-3.5" />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {mark?.says}
      </TooltipContent>
    </Tooltip>
  );
}
