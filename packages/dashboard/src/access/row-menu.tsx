// What sits at the end of a row of Access that can be taken out: the menu the rows of every table of the dashboard end with, holding Remove.

import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** What a row's menu is drawn from. */
interface RowMenuProps {
  /** What the row is, as a person reads it: an email, or a computer's name. */
  readonly name: string;

  /** Asked when Remove is chosen: the screen then asks before anything is removed. */
  readonly onRemove: () => void;
}

/** Draw a row's menu. It is quiet until the row is pointed at or holds the focus, and whole on a touch screen. */
export function RowMenu({ name, onRemove }: RowMenuProps): ReactNode {
  return (
    <span className="inline-flex items-center opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`} title="More" className="pointer-coarse:size-10" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
