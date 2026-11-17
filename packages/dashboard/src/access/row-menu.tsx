// What sits at the end of a row of Access that can be taken out: the menu the rows of every table of the dashboard end with, holding Remove for a user and Revoke for a token.

import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** What a row's menu is drawn from. */
interface RowMenuProps {
  /** What the row is, as a person reads it: an email, or a machine's name. */
  readonly name: string;

  /** What taking the row out is called: a user is removed, a token is revoked. */
  readonly word: "Remove" | "Revoke";

  /** Asked when that is chosen: the screen then asks before anything is taken out. */
  readonly onRemove: () => void;
}

/** Draw a row's menu. It is quiet until the row is pointed at or holds the focus, and whole on a touch screen. */
export function RowMenu({ name, word, onRemove }: RowMenuProps): ReactNode {
  return (
    <span className="inline-flex items-center opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`} title="More" className="pointer-coarse:size-10" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            {word}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
