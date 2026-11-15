// The line of the address that starts a rebuild of the install. It is a credential: it is typed into a field that hides it, it waits for the screen's Save like a setting, and once saved the line says only that one is set, and since when.

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { sayDone, send } from "@/lib/notify";
import { wholeMoment } from "@/lib/sites";
import { Confirm } from "@/shared/confirm";
import type { AddressDraft } from "@/settings/address-draft";
import { RowLine } from "@/settings/row-line";
import { SETTINGS_KEY, type UpdateAddress } from "@/settings/settings-queries";

/** The id of the field the address is typed into. */
export const ADDRESS_FIELD = "update-address";

/** What the line says under its name: what the address does. */
const USE = "The secret address that starts an update of poplin.";

/** What the line's question mark says the address is for. */
const MEANING = "A secret address your host gives you. Poplin calls it to rebuild itself with the newest version. Once saved it is never shown again.";

/** The question before the address is removed: it cannot be read back, so nothing puts it back. */
const REMOVE = {
  title: "Remove the rebuild address?",
  says: "The install can no longer start its own update until an address is saved again. The address cannot be read back from here.",
  yes: "Remove",
  removes: true,
} as const;

/**
 * Draw the line of the rebuild address.
 *
 * @param state - whether an address is saved, and since when
 * @param draft - the address while it is typed
 */
export function UpdateAddressRow({ state, draft }: { readonly state: UpdateAddress; readonly draft: AddressDraft }): ReactNode {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const since = state.set ? state.since : null;

  const remove = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const done = await send(api.settings["update-address"].remove.$post({ json: {} }));
    if (done === undefined) return;

    await client.invalidateQueries({ queryKey: SETTINGS_KEY });
    sayDone("Removed.");
  };

  return (
    <RowLine
      label="Rebuild address"
      controlId={ADDRESS_FIELD}
      about={() => <p>{MEANING}</p>}
      help={since === null ? `${USE} None is saved.` : `${USE} Saved ${wholeMoment(since)}.`}
      refusal={draft.refusal}
    >
      {since !== null && !draft.replacing ? (
        <>
          <Button type="button" variant="outline" onClick={draft.replace}>
            Replace
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAsking(true)}>
            Remove
          </Button>
        </>
      ) : (
        <>
          <Input
            id={ADDRESS_FIELD}
            type="password"
            value={draft.typed}
            onChange={(event) => draft.type(event.target.value)}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={draft.refusal !== undefined}
            className="min-w-0 flex-1"
          />
          {draft.replacing ? (
            <Button type="button" variant="ghost" onClick={draft.discard}>
              Cancel
            </Button>
          ) : null}
        </>
      )}
      <Confirm question={asking ? REMOVE : undefined} onAnswer={(yes) => void remove(yes)} />
    </RowLine>
  );
}
