// One press at a time: a button or a dialog that sends a change takes no second press while the first is on its way.
// A double click and a second Enter come before the page is drawn again, so a button that is only drawn as off still takes them: the press is counted here, at once.

import { useRef, useState } from "react";

/** A piece's hold on its work: the way to start it, and whether a run of it is on its way. */
interface OnePress<Args extends readonly unknown[]> {
  /** Starts the work, unless a run of it is still on its way: such a press does nothing. */
  readonly press: (...args: Args) => void;

  /** Whether a run is on its way: the piece draws its button as off for as long. */
  readonly busy: boolean;
}

/**
 * Take one press at a time for a piece of work.
 *
 * @param work - what a press starts; a promise it answers is waited for, and whatever it rejects with is thrown on as before
 */
export function useOnePress<Args extends readonly unknown[]>(work: (...args: Args) => unknown): OnePress<Args> {
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (args: Args): Promise<void> => {
    try {
      await work(...args);
    } finally {
      held.current = false;
      setBusy(false);
    }
  };
  const press = (...args: Args): void => {
    if (held.current) return;

    held.current = true;
    setBusy(true);
    void run(args);
  };

  return { press, busy };
}
