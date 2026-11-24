// When a site expires, in its panel: the moment, and the menu that sets another or none. A site that expires moves to the trash.

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";

import { Field, FieldError } from "@/components/ui/field";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone } from "@/lib/notify";
import type { Site } from "@/lib/sites";
import { PanelFact } from "@/shared/side-panel";
import { sentFor } from "@/dialog/expiry/expiry-moments";
import { ExpiryPicker } from "@/dialog/expiry/expiry-picker";
import { SITES_KEY } from "@/sites/site-queries";

/** The spans a person chooses between, in days from the moment the menu opened. */
const SPANS = [1, 7, 30] as const;

/** What the calendar says of the day that is picked. */
const DAY_SAYS = "The site expires when that day starts. Then it moves to the trash.";

/** What stands under the moment: what its link does then, and where the site goes. */
function afterIt(expires: Site["expires"], now: number): string | undefined {
  if (expires === "never") return undefined;

  return expires > now ? "Then its link stops working, and it moves to the trash." : "Its link has stopped working. It moves to the trash soon.";
}

/**
 * Draw when a site deletes itself as a fact of its panel, with the menu that changes it. Use inside `PanelFacts`.
 *
 * A change is saved at once and said in one line with Undo; a refusal stands under the fact until the next choice.
 */
export function ExpiryRow({ site }: { readonly site: Site }): ReactNode {
  const client = useQueryClient();
  // The moment the row was drawn, or its menu last opened: what stands under the fact is read at it.
  const [now, setNow] = useState(() => Date.now());
  const [refusal, setRefusal] = useState<string>();
  // When the site deletes itself as the server last said: the panel's reading, or a newer answer to a change, which the panel has yet to read.
  const read = useRef(site.expires);
  const stored = useRef(site.expires);
  if (read.current !== site.expires) [read.current, stored.current] = [site.expires, site.expires];

  /** Send what the site is to delete itself at, and answer the sentence of a refusal. Only a change a person chose offers Undo. */
  const send = async (expires: string, chosen: boolean): Promise<string | undefined> => {
    const before = stored.current;
    try {
      stored.current = (await answerOf(api.sites[":site"].expiry.$post({ param: { site: site.label }, json: { expires } }))).site.expires;
    } catch (error) {
      if (error instanceof Refused) return error.message;

      throw error;
    }

    void client.invalidateQueries({ queryKey: SITES_KEY });
    // A moment that has passed is not offered again.
    const undo = (): void => void send(sentFor(before), false).then(setRefusal);
    if (chosen && (before === "never" || before > Date.now())) sayDone("Saved.", { run: undo });
    else sayDone(chosen ? "Saved." : "Put back.");

    return undefined;
  };
  const choose = async (expires: string): Promise<void> => setRefusal(await send(expires, true));
  // A day that was saved takes an older refusal away from under the fact; one that was refused is said in its dialog.
  const saveDay = async (moment: number): Promise<string | undefined> => {
    const refused = await send(sentFor(moment), true);
    if (refused === undefined) setRefusal(undefined);

    return refused;
  };
  const note = afterIt(site.expires, now);

  return (
    <PanelFact name="Expires">
      <div className="flex flex-col gap-1">
        <ExpiryPicker expires={site.expires} spans={SPANS} daySays={DAY_SAYS} onChoose={(expires) => void choose(sentFor(expires))} onDay={saveDay} onOpen={setNow} />
        {note === undefined ? null : <p className="text-muted-foreground">{note}</p>}
        {refusal === undefined ? null : (
          <Field invalid>
            <FieldError>{refusal}</FieldError>
          </Field>
        )}
      </div>
    </PanelFact>
  );
}
