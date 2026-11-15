// A button that is only an icon: its name is its label for a screen reader and the hint a pointer shows.

import { cn } from "cn";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** What an icon button is drawn from. With `link` it is a link that looks like the button. */
interface IconButtonProps {
  /** What the button does, in a few words. */
  readonly label: string;

  /** The icon. */
  readonly children: ReactNode;

  /** What a press does. */
  readonly onClick?: ComponentProps<"button">["onClick"];

  /** The link the button is drawn as, which says where it leads: the router's for a place of the console. */
  readonly link?: ReactElement;

  /** Classes laid over the button's own. */
  readonly className?: string;
}

/** Draw an icon button, or a link that looks like one. */
export function IconButton({ label, children, onClick, link, className }: IconButtonProps): ReactNode {
  const button =
    link === undefined ? (
      <Button variant="ghost" size="icon-sm" aria-label={label} className={cn("pointer-coarse:size-10", className)} onClick={onClick} />
    ) : (
      <Button variant="ghost" size="icon-sm" aria-label={label} className={cn("pointer-coarse:size-10", className)} nativeButton={false} render={link} />
    );

  return (
    <Tooltip>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
