// What sits at the end of a site's row: the menu of what is done to a site without opening it. A site in the trash has Restore there.

import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Site, shownName } from "@/lib/sites";
import type { SiteActions } from "@/sites/site-actions";
import type { Ask } from "@/sites/site-questions";

/** What a row's actions are drawn from. */
interface SiteRowActionsProps {
  /** The row's site. */
  readonly site: Site;

  /** The changes of a site. */
  readonly actions: SiteActions;

  /** Asks a question about the site before a change: the screen draws it, and the table stays as it is. */
  readonly onAsk: (site: Site, ask: Ask) => void;

  /** Called after the site went to the trash. */
  readonly onRemoved: (site: Site) => void;
}

/** Draw a row's actions. They show when the row is pointed at or holds the focus, and always on a touch screen. */
export function SiteRowActions({ site, actions, onAsk, onRemoved }: SiteRowActionsProps): ReactNode {
  if (site.state === "trash") {
    return (
      <Button variant="outline" size="sm" onClick={() => void actions.restore(site)}>
        Restore
      </Button>
    );
  }

  const remove = async (): Promise<void> => {
    if (await actions.remove(site)) onRemoved(site);
  };

  return (
    <span className="inline-flex items-center gap-0.5 opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${shownName(site)}`} title="More" className="pointer-coarse:size-10" />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem render={<a href={site.url} target="_blank" rel="noreferrer" />}>Open</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAsk(site, { kind: "naming" })}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAsk(site, { kind: "new-link" })}>New link</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
