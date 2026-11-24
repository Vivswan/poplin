// Copying a text to the clipboard of the person who sits at this machine. A machine with no clipboard is no error: what is copied is printed either way.

import { startHere } from "./browser";
import type { Machine } from "./login-file";

/**
 * Copy a text to the person's clipboard, when this machine looks like one a person sits at.
 *
 * The `clipboardy` library writes it, and is loaded by the first copy: no other command needs it, and loading it throws on a platform it has no way to copy on.
 *
 * @returns whether the text was copied. A machine with no clipboard, or with no tool that writes to one, answers `false`, and nothing throws
 */
export async function copyText(text: string, machine: Machine): Promise<boolean> {
  return startHere(machine, async () => {
    const { default: clipboard } = await import("clipboardy");

    await clipboard.write(text);
  });
}
