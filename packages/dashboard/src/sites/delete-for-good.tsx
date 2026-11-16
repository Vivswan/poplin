// The button that deletes a site in the trash for good, in the site's panel. It asks first.

import { type ReactNode, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { Site } from "@/lib/sites";
import { askDeleteForGood } from "@/sites/delete-for-good-question";

/** What the button is drawn from. */
interface DeleteForGoodProps {
  /** The site, which is in the trash. */
  readonly site: Site;

  /** Called once the site is gone, before the list is read again. */
  readonly onGone: () => void;
}

/** Draw the button. A press asks the question the Sites screen draws, which deletes the site once its name is typed. */
export function DeleteForGood({ site, onGone }: DeleteForGoodProps): ReactNode {
  const opener = useRef<HTMLButtonElement>(null);

  return (
    <Button ref={opener} variant="destructive" onClick={() => askDeleteForGood({ site, opener: opener.current, onGone })}>
      Delete for good
    </Button>
  );
}
