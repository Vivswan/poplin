// The rebuild address while it is typed: it waits for the screen's one Save like a setting, but is saved by a request of its own, and is never read back.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { SETTINGS_KEY } from "@/settings/settings-queries";

/** What is shown when a save fails for a reason that is no refusal. */
const FAULT = "That did not work. Try again.";

/** The typed address and what is done with it. */
export interface AddressDraft {
  /** What the field holds. */
  readonly typed: string;

  /** Whether the field is shown over a saved address, to replace it. */
  readonly replacing: boolean;

  /** The sentence the last save was refused with, until the field is typed in again. */
  readonly refusal: string | undefined;

  /** Whether the field holds an address that is not saved, nor on its way to be. */
  readonly unsaved: boolean;

  /** Whether a save is on its way. */
  readonly busy: boolean;

  /** Hold what was typed. */
  readonly type: (typed: string) => void;

  /** Show the field over a saved address. */
  readonly replace: () => void;

  /** Empty the field, and show the saved address again where one is. */
  readonly discard: () => void;

  /** Save the typed address. It answers whether nothing is left refused: `true` also when nothing was typed. */
  readonly save: () => Promise<boolean>;
}

/** Keep the typed rebuild address of the screen. */
export function useAddressDraft(): AddressDraft {
  const client = useQueryClient();
  const [typed, setTyped] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [refusal, setRefusal] = useState<string>();

  const discard = (): void => {
    setTyped("");
    setReplacing(false);
    setRefusal(undefined);
  };

  const saving = useMutation({
    mutationFn: (address: string) => answerOf(api.settings["update-address"].$post({ json: { address } })),
    onSuccess: async (_done, address) => {
      // The field lets go of the address the moment it is saved; one typed while the save was on its way stays.
      setTyped((kept) => (kept.trim() === address ? "" : kept));
      setReplacing((kept) => kept && typed.trim() !== address);
      await client.invalidateQueries({ queryKey: SETTINGS_KEY });
      sayDone("Rebuild address saved. It is not shown again.");
    },
    onError: (error) => {
      if (error instanceof Refused && error.about === "address") setRefusal(error.message);
      else sayRefused(error instanceof Refused ? error.message : FAULT);
    },
  });
  const unsaved = typed.trim() !== "" && typed.trim() !== (saving.isPending ? saving.variables : undefined);

  const save = async (): Promise<boolean> => {
    if (!unsaved) return true;

    return saving.mutateAsync(typed.trim()).then(
      () => true,
      () => false,
    );
  };

  const type = (next: string): void => {
    setTyped(next);
    setRefusal(undefined);
  };

  return { typed, replacing, refusal, unsaved, busy: saving.isPending, type, replace: () => setReplacing(true), discard, save };
}
