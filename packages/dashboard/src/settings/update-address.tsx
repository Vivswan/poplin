// The row of the address that starts a rebuild of the install. It is a credential: it is typed into a field that hides it, and once saved the screen says only that one is set, and since when.

import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused, send } from "@/lib/notify";
import { wholeMoment } from "@/lib/sites";
import { Confirm } from "@/shared/confirm";
import { RowFrame } from "@/settings/row-frame";
import { SETTINGS_KEY, type UpdateAddress } from "@/settings/settings-queries";

/** The id of the field the address is typed into. */
const FIELD_ID = "update-address";

/** What the row says the address is for. */
const MEANING = "A secret address the host gives. The install calls it to rebuild itself with the newest version. It is never shown again.";

/** The question before the address is removed: it cannot be read back, so nothing puts it back. */
const REMOVE = {
  title: "Remove the rebuild address?",
  says: "The install can no longer start its own update until an address is saved again. The address cannot be read back from here.",
  yes: "Remove",
  removes: true,
} as const;

/** What is shown when a save fails for a reason that is no refusal. */
const FAULT = "That did not work. Try again.";

/** What the field is drawn from. */
interface AddressFieldProps {
  /** Whether a saved address is being replaced: the field then has a Cancel. */
  readonly replacing: boolean;

  /** Called once the address is saved. */
  readonly onSaved: () => Promise<void>;

  /** Called by Cancel. */
  readonly onLeave: () => void;

  /** Told whether the field holds an address that is not saved. It must stay the same function from one drawing to the next. */
  readonly onUnsaved: (unsaved: boolean) => void;
}

/** The field the address is typed into, with the buttons that save it or leave it. */
function AddressField({ replacing, onSaved, onLeave, onUnsaved }: AddressFieldProps): ReactNode {
  const [typed, setTyped] = useState("");
  const [refusal, setRefusal] = useState<string>();
  const [busy, setBusy] = useState(false);
  const unsaved = typed.trim() !== "";

  useEffect(() => {
    onUnsaved(unsaved);

    return () => onUnsaved(false);
  }, [onUnsaved, unsaved]);

  const save = async (): Promise<void> => {
    if (typed.trim() === "" || busy) return;

    setBusy(true);
    try {
      await answerOf(api.settings["update-address"].$post({ json: { address: typed.trim() } }));
      // The field lets go of the address the moment it is saved, whatever becomes of the read that follows.
      setTyped("");
      await onSaved();
      sayDone("Saved. The address is not shown again.");
    } catch (error) {
      if (error instanceof Refused && error.about === "address") setRefusal(error.message);
      else sayRefused(error instanceof Refused ? error.message : FAULT);
    } finally {
      setBusy(false);
    }
  };

  // The row sits in its group's form, whose Save is for the settings: Enter here saves the address alone.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    void save();
  };

  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <Input
          id={FIELD_ID}
          type="password"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setRefusal(undefined);
          }}
          onKeyDown={onKeyDown}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={refusal !== undefined}
          className="max-w-72 basis-full"
        />
        <Button type="button" variant="outline" size="sm" disabled={typed.trim() === "" || busy} onClick={() => void save()}>
          Save address
        </Button>
        {replacing ? (
          <Button type="button" variant="ghost" size="sm" onClick={onLeave}>
            Cancel
          </Button>
        ) : null}
      </span>
      {refusal === undefined ? null : <FieldError className="text-[13px]">{refusal}</FieldError>}
    </>
  );
}

/**
 * Draw the row of the rebuild address.
 *
 * @param state - whether an address is saved, and since when
 * @param onUnsaved - told whether the field holds an address that is not saved; the same function from one drawing to the next
 */
export function UpdateAddressRow({ state, onUnsaved }: { readonly state: UpdateAddress; readonly onUnsaved: (unsaved: boolean) => void }): ReactNode {
  const client = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [asking, setAsking] = useState(false);
  const read = (): Promise<void> => client.invalidateQueries({ queryKey: SETTINGS_KEY });

  const remove = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const done = await send(api.settings["update-address"].remove.$post({ json: {} }));
    if (done === undefined) return;

    await read();
    sayDone("Removed.");
  };

  const saved = async (): Promise<void> => {
    await read();
    setReplacing(false);
  };

  return (
    <RowFrame label="Rebuild address" controlId={FIELD_ID} meaning={MEANING} fallback="None">
      {state.set && state.since !== null && !replacing ? (
        <span className="flex min-h-8 flex-wrap items-center gap-2">
          <span id={FIELD_ID} className="mr-1">
            Set, since {wholeMoment(state.since)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(true)}>
            Remove
          </Button>
        </span>
      ) : (
        <AddressField replacing={replacing} onSaved={saved} onLeave={() => setReplacing(false)} onUnsaved={onUnsaved} />
      )}
      <Confirm question={asking ? REMOVE : undefined} onAnswer={(yes) => void remove(yes)} />
    </RowFrame>
  );
}
