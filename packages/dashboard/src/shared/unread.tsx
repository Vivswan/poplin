// What stands in the place of a list or a screen that could not be read: the sentence that says why, and the way to read it again.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** What the place is drawn from. */
interface UnreadProps {
  /** What did not come, such as "The users could not be read". */
  readonly title: string;

  /** The sentence that says why, or what to do. */
  readonly failure: string;

  /** Tries again: reads the list again, or loads the page again. */
  readonly onRetry: () => void;
}

/** Draw the place of a list or a screen that did not come. */
export function Unread({ title, failure, onRetry }: UnreadProps): ReactNode {
  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{failure}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
