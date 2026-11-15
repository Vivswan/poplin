// The line of the update link, the address that starts an update of the install. It is a credential: it is pasted into a field that hides it, it waits for the screen's Save like a setting, and once saved the line says only that one is set, and since when.

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

/** What the line's question mark says of the link. */
const MEANING = "Lets poplin update itself.";

/** The question before the link is removed: it cannot be read back, so nothing puts it back. */
const REMOVE = {
  title: "Remove the update link?",
  says: "Poplin can no longer update itself until a link is saved again. The link cannot be read back from here.",
  yes: "Remove",
  removes: true,
} as const;

/**
 * Draw the line of the update link.
 *
 * @param state - whether a link is saved, and since when
 * @param draft - the link while it is pasted
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
      label="Update link"
      controlId={ADDRESS_FIELD}
      about={() => <p>{MEANING}</p>}
      help={since === null ? "Not set" : `Set ${wholeMoment(since)}`}
      refusal={draft.refusal}
    >
      {draft.open || draft.typed !== "" ? null : (
        <>
          <Button type="button" variant="outline" onClick={draft.show}>
            {since === null ? "Add" : "Replace"}
          </Button>
          {since === null ? null : (
            <Button type="button" variant="ghost" onClick={() => setAsking(true)}>
              Remove
            </Button>
          )}
        </>
      )}
      {draft.open || draft.typed !== "" ? (
        <>
          <Input
            id={ADDRESS_FIELD}
            type="password"
            value={draft.typed}
            onChange={(event) => draft.type(event.target.value)}
            placeholder="Paste the update link"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={draft.refusal !== undefined}
            className="w-64 min-w-0 max-md:w-auto max-md:flex-1"
          />
          <Button type="button" variant="ghost" onClick={draft.discard}>
            Cancel
          </Button>
        </>
      ) : null}
      <Confirm question={asking ? REMOVE : undefined} onAnswer={(yes) => void remove(yes)} />
    </RowLine>
  );
}
