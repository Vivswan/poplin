// One block of the Access screen: its name, how many it holds, what they are in a few words, and its tools at the right.

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** What a block is drawn from. */
interface AccessSectionProps {
  /** The block's name, such as "People". */
  readonly title: string;

  /** How many things the block holds; left out while they are being read. */
  readonly count?: number;

  /** What the things are, in a few words beside the name. */
  readonly says: string;

  /** What sits at the right of the name's line. */
  readonly tools?: ReactNode;

  /** The block's list, and what stands under it. */
  readonly children: ReactNode;
}

/** Draw a block of the Access screen. */
export function AccessSection({ title, count, says, tools, children }: AccessSectionProps): ReactNode {
  return (
    <section aria-label={title} className="flex flex-col">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 px-6 max-md:px-4 max-md:py-2">
        <h2 className="font-bold">{title}</h2>
        {count === undefined ? null : <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        <span className="min-w-0 truncate pl-1 text-[13px] text-muted-foreground max-md:order-last max-md:w-full max-md:pl-0">{says}</span>
        {tools === undefined ? null : <div className="ml-auto flex items-center gap-2">{tools}</div>}
      </header>
      {children}
    </section>
  );
}

/** What stands where a block's rows would while they are being read, or the sentence of a read that was refused. */
export function InsteadOfRows({ failure }: { readonly failure: string | undefined }): ReactNode {
  if (failure !== undefined) return <p className="border-t px-6 py-3 text-muted-foreground max-md:px-4">{failure}</p>;

  return (
    <div className="flex flex-col border-t" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="flex h-11 items-center border-b px-6 max-md:px-4">
          <Skeleton className="h-4 w-56" />
        </div>
      ))}
    </div>
  );
}
