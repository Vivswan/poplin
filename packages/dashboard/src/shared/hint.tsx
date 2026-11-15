// A small icon that opens a note beside it: on a pointer resting on it, on a press, and from the keyboard. The note may hold a button, and closes on Escape and on a press outside.

import { cn } from "cn";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** How long a pointer rests on the icon before the note opens, in milliseconds. */
const REST = 120;

/** What a hint is drawn from. */
interface HintProps {
  /** What the icon stands for, for a screen reader: the whole of a short note, or the name of a longer one. */
  readonly label: string;

  /** The icon. */
  readonly icon: ReactNode;

  /** Classes laid over the icon's button, such as its colour. */
  readonly className?: string;

  /** The note. It is handed a function that closes it, for a button inside. */
  readonly children: (close: () => void) => ReactNode;
}

/** Draw the icon and, while it is open, its note. */
export function Hint({ label, icon, className, children }: HintProps): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={REST}
        render={<Button type="button" variant="ghost" size="icon-xs" aria-label={label} className={cn("shrink-0 text-faint [&_svg]:size-3.5", className)} />}
      >
        {icon}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-2 p-3 text-[13px] leading-5">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}
