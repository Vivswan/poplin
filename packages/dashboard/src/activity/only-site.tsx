// The mark beside the Activity search that says the log shows one site alone, with the way back to every site.

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Page } from "@/activity/activity-queries";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/shared/icon-button";

/** What the mark is drawn from. */
interface OnlySiteProps {
  /** The id the address narrows the log to. */
  readonly of: string;

  /** The page that is shown: the one the address asks for, or the one before it while that is on its way. */
  readonly page: Page | undefined;

  /** Whether the page shown is the one the address asks for. */
  readonly current: boolean;

  /** Called at a press on the mark's button: the log shows every site again. */
  readonly onShowEvery: () => void;
}

/**
 * What the one site is called: as its own page says, and while the page before is still shown, as the row that was pressed there names it.
 *
 * @returns the words "this site" until a page names it, and for a site that is gone with no entry on the page
 */
function calledOn({ of, page, current }: Pick<OnlySiteProps, "of" | "page" | "current">): string {
  const site = (current ? page?.of : null) ?? page?.entries.find((entry) => entry.site?.id === of)?.site ?? null;
  if (site === null) return "this site";

  return site.title ?? site.name ?? "this site";
}

/** Draw the mark: "Only" and what the site is called, with a button that takes the mark away. */
export function OnlySite({ of, page, current, onShowEvery }: OnlySiteProps): ReactNode {
  const called = calledOn({ of, page, current });

  return (
    // Beside the search where the toolbar has the room, and on a line of its own where it has none: under the toolbar, and on a phone under the search.
    <div className="flex min-w-0 max-xl:order-5 max-xl:basis-full max-md:order-3">
      <Badge variant="secondary" className="h-8 max-w-64 min-w-0 shrink gap-0.5 pr-0.5 pl-3 text-sm font-normal max-md:h-10 max-md:max-w-full" title={`Only ${called}`}>
        <span className="truncate">Only {called}</span>
        {/* The row's button that put the mark here left with the press: this one takes the focus from it. */}
        <IconButton label="Show every site" onClick={onShowEvery} className="size-7 rounded-full pointer-coarse:size-8" home>
          <XIcon />
        </IconButton>
      </Badge>
    </div>
  );
}
