// A button that is only an icon: its name is its label for a screen reader and the hint a pointer shows.

import { cn } from "cn";
import { type ComponentProps, type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOCUS_HOME } from "@/lib/focus";

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

  /** `true` for a button that takes a focus its screen lost. */
  readonly home?: boolean;
}

/** Draw an icon button, or a link that looks like one. */
export function IconButton({ label, children, onClick, link, className, home = false }: IconButtonProps): ReactNode {
  const [hinting, setHinting] = useState(false);
  // An open hint takes an Escape for itself, and the dialog or menu around the button would need a second one. The hint closes before the press goes on, so one Escape closes what is around it.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && hinting) flushSync(() => setHinting(false));
  };
  const shared = { variant: "ghost", size: "icon-sm", "aria-label": label, className: cn("pointer-coarse:size-10", className), onKeyDownCapture } as const;
  const button =
    link === undefined ? <Button {...shared} onClick={onClick} {...(home ? FOCUS_HOME : {})} /> : <Button {...shared} nativeButton={false} render={link} />;

  return (
    <Tooltip open={hinting} onOpenChange={setHinting}>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
