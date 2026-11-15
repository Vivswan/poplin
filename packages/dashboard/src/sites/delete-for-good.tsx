// The control that deletes a site in the trash for good: a button in the site's panel, a menu with the one entry in its row. Either asks first.

import { MoreHorizontalIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Site, shownName } from "@/lib/sites";
import { askDeleteForGood } from "@/sites/delete-for-good-question";

/** What the control is drawn from. */
interface DeleteForGoodProps {
  /** The site, which is in the trash. */
  readonly site: Site;

  /** How the control is drawn: as a row's menu with the one entry, or as a button. */
  readonly look: "menu" | "button";

  /** Called once the site is gone, before the list is read again. */
  readonly onGone: () => void;
}

/** Draw the control. A press asks the question the Sites screen draws, which deletes the site once its name is typed. */
export function DeleteForGood({ site, look, onGone }: DeleteForGoodProps): ReactNode {
  const opener = useRef<HTMLButtonElement>(null);
  const ask = (): void => askDeleteForGood({ site, opener: opener.current, onGone });

  if (look === "button") {
    return (
      <Button ref={opener} variant="destructive" onClick={ask}>
        Delete for good
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button ref={opener} variant="ghost" size="icon-sm" aria-label={`More for ${shownName(site)}`} title="More" className="pointer-coarse:size-10" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem variant="destructive" onClick={ask}>
          Delete for good
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
