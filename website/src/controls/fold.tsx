import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";

interface Props {
  /** The name a link reaches what is folded by. */
  id: string;

  /** The words of the trigger. */
  label: string;

  /** What is folded. */
  children: React.ReactNode;
}

/**
 * A folded part of the page, closed at first. The panel is hidden until found, so the browser itself opens it for a link
 * pressed on the page to the name of what it holds, and for a search of the page.
 */
export function Fold({ id, label, children }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [arrived, setArrived] = useState(false);
  const held = useRef<HTMLDivElement>(null);

  // A page opened at the name is built closed, and a browser finds nothing in a page as it is built: that one arrival is opened here.
  useEffect(() => {
    if (location.hash !== `#${id}`) return;

    setOpen(true);
    setArrived(true);
  }, [id]);

  // The browser moved nowhere on that arrival, so the page is put there once it is open, with no glide.
  useEffect(() => {
    if (arrived) held.current?.scrollIntoView({ behavior: "instant" });
  }, [arrived]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full min-w-0">
      <CollapsibleTrigger render={<Button variant="ghost" size="line" />}>
        <ChevronRightIcon />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent hiddenUntilFound>
        <div ref={held} id={id} className="scroll-mt-[56px]">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
