// A button that is only an icon: its label is the hint a pointer shows, and its name for a screen reader unless it is given a longer one.
// And the icon button that reads one thing of a screen again, with the words that say how old what is shown is. Only a thing a person may want newer than its time to stand gets one.

import type { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { UseQueryResult } from "@tanstack/react-query";
import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOCUS_HOME } from "@/lib/focus";
import { agoWords } from "@/lib/timezone";

/** How often the words that say how old the read is are written again, in milliseconds. */
const TICK_MS = 10_000;

/** What an icon button is drawn from. With `link` it is a link that looks like the button. */
interface IconButtonProps {
  /** What the button does, in a few words. */
  readonly label: string;

  /** What a screen reader calls it where a list holds one such button in every row: the label with the row's own name, such as "Copy the link of Notes". Left out, the label. */
  readonly name?: string;

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

/** What a refresh button is drawn from. */
interface RefreshButtonProps {
  /** What the button reads again, as its hint and its name say it: "Refresh the list". */
  readonly label: string;

  /** The read: when it was last made, whether it is under way, and the way to make it again. */
  readonly read: Pick<UseQueryResult, "dataUpdatedAt" | "isFetching" | "refetch">;
}

/** Draw an icon button, or a link that looks like one. */
export function IconButton({ label, name = label, children, onClick, link, className, home = false }: IconButtonProps): ReactNode {
  const hint = useRef<TooltipPrimitive.Root.Actions>(null);
  // An open hint takes an Escape for itself, and the dialog or menu around the button would need a second one. The hint is closed by its own action before the press goes on, so one Escape closes what is around it.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.key === "Escape") hint.current?.close();
  };
  const shared = { variant: "ghost", size: "icon-sm", "aria-label": name, className: cn("pointer-coarse:size-10", className), onKeyDownCapture } as const;
  const button =
    link === undefined ? <Button {...shared} onClick={onClick} {...(home ? FOCUS_HOME : {})} /> : <Button {...shared} nativeButton={false} render={link} />;

  return (
    <Tooltip actionsRef={hint}>
      <TooltipTrigger render={button}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The moment it is now, told again every `every` milliseconds while the part that asks is drawn. */
function useNow(every: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), every);

    return () => window.clearInterval(tick);
  }, [every]);

  return now;
}

/** Draw the button, and before it how long ago the read was made, where the screen is wide enough for the words. While the read is under way the button turns, and a press starts no second one. */
export function RefreshButton({ label, read }: RefreshButtonProps): ReactNode {
  const now = useNow(TICK_MS);

  return (
    <span className="flex shrink-0 items-center gap-1">
      {read.dataUpdatedAt === 0 ? null : (
        <span className="text-xs whitespace-nowrap text-faint max-md:hidden">Updated {agoWords(read.dataUpdatedAt, now)}</span>
      )}
      <IconButton label={label} onClick={() => void read.refetch({ cancelRefetch: false })}>
        {read.isFetching ? <Spinner /> : <RefreshCwIcon />}
      </IconButton>
    </span>
  );
}
