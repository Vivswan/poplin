// The buttons of a line that says a result: the step that takes the change back or goes on from it, then Close, in the order the keys reach them.

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/shared/icon-button";

/** What a line's buttons are drawn from. */
interface LineButtonsProps {
  /** The words of the first button, such as "Undo". */
  readonly label: string;

  /** What a press on the first button does. The line leaves after it. */
  readonly onPress: () => void;

  /** Takes the line away. */
  readonly onClose: () => void;
}

/** Draw a line's buttons at its end. */
export function LineButtons({ label, onPress, onClose }: LineButtonsProps): ReactNode {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button size="sm" onClick={onPress}>
        {label}
      </Button>
      <IconButton label="Close" onClick={onClose}>
        <XIcon />
      </IconButton>
    </div>
  );
}
