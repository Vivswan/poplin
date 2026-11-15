// What stands in a list's place when it could not be read: the server's sentence, and the way to read it again.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/** What the place is drawn from. */
interface UnreadProps {
  /** What could not be read, such as "The users could not be read". */
  readonly title: string;

  /** The sentence of the read that was refused. */
  readonly failure: string;

  /** Reads the list again. */
  readonly onRetry: () => void;
}

/** Draw the place of a list that could not be read. */
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
