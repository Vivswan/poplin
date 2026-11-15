// The block of the update link, the address that starts an update of the install. It is a credential: it is pasted into a field that hides it and waits for the screen's Save like a setting. Once saved, the block says only that one is set, and since when.

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FOCUS_HOME } from "@/lib/focus";
import { sayDone, send } from "@/lib/notify";
import { wholeMoment } from "@/lib/sites";
import { Confirm } from "@/shared/confirm";
import type { AddressDraft } from "@/settings/address-draft";
import { SettingFrame } from "@/settings/setting-frame";
import { SETTINGS_KEY, type UpdateAddress } from "@/settings/settings-queries";

/** The id of the field the link is pasted into. */
export const ADDRESS_FIELD = "update-address";

/** The id of the sentence a pasted link was refused with, which the field names as what describes it. */
const REFUSAL = `${ADDRESS_FIELD}-refusal`;

/** What the block says the link does. */
const SAYS = "Lets poplin update itself.";

/** The question before the link is removed: it cannot be read back, so nothing puts it back. */
const REMOVE = {
  title: "Remove the update link?",
  says: "Until a link is saved again, poplin cannot update itself. The link cannot be read back from here.",
  yes: "Remove",
  removes: true,
} as const;

/**
 * Draw the block of the update link.
 *
 * @param state - whether a link is saved, and since when
 * @param draft - the link while it is pasted
 */
export function UpdateAddressRow({ state, draft }: { readonly state: UpdateAddress; readonly draft: AddressDraft }): ReactNode {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const since = state.set ? state.since : null;
  const pasting = draft.open || draft.typed !== "";

  const remove = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const done = await send(api.settings["update-address"].remove.$post({ json: {} }));
    if (done === undefined) return;

    await client.invalidateQueries({ queryKey: SETTINGS_KEY });
    sayDone("Removed.");
  };

  return (
    <SettingFrame
      name="Update link"
      controlId={ADDRESS_FIELD}
      says={[SAYS]}
      under={
        draft.refusal === undefined ? undefined : (
          <FieldError id={REFUSAL} className="text-[13px]">
            {draft.refusal}
          </FieldError>
        )
      }
    >
      {pasting ? (
        <>
          <Input
            id={ADDRESS_FIELD}
            type="password"
            aria-labelledby={`${ADDRESS_FIELD}-label`}
            value={draft.typed}
            onChange={(event) => draft.type(event.target.value)}
            placeholder="Paste the update link"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={draft.refusal !== undefined}
            aria-describedby={draft.refusal === undefined ? undefined : REFUSAL}
            autoFocus
            className="w-72 max-w-full min-w-0"
          />
          <Button type="button" variant="ghost" onClick={draft.discard}>
            Cancel
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p>{since === null ? "Not set" : `Set ${wholeMoment(since)}`}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={draft.show} {...FOCUS_HOME}>
              {since === null ? "Add" : "Replace"}
            </Button>
            {since === null ? null : (
              <Button type="button" variant="ghost" onClick={() => setAsking(true)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
      <Confirm question={asking ? REMOVE : undefined} onAnswer={(yes) => void remove(yes)} />
    </SettingFrame>
  );
}
