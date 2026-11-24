// When a site expires, in its panel: the moment, and the menu that sets another or none. A site that expires moves to the trash.

import { useQueryClient } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError } from "@/components/ui/field";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone } from "@/lib/notify";
import type { Site } from "@/lib/sites";
import { momentIn } from "@/lib/timezone";
import { PanelFact } from "@/shared/side-panel";
import { afterDays, sentFor } from "@/dialog/expiry/expiry-moments";
import { backTo, expiryMoment, SPANS } from "@/sites/expiry/expiry";
import { SITES_KEY } from "@/sites/site-queries";

/** The dialog that asks for a day, read from the server when a day is first asked for: it holds the calendar. */
const ExpiryDayDialog = lazy(async () => ({ default: (await import("@/dialog/expiry/expiry-day-dialog")).ExpiryDayDialog }));

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
  const opener = useRef<HTMLButtonElement>(null);
  // The moment the menu opened: each span is written as the moment it ends when counted from then, and a choice saves the moment that was written.
  const [opened, setOpened] = useState(() => Date.now());
  // Whether a day is asked for now, and whether one ever was: the dialog is read only then.
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState(false);
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
    const undo = (): void => void send(backTo(before), false).then(setRefusal);
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
  const pickDay = (): void => {
    setPicks(true);
    setPicking(true);
  };
  const note = afterIt(site.expires, opened);

  return (
    <PanelFact name="Expires">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{expiryMoment(site.expires)}</span>
          <DropdownMenu onOpenChange={(open) => (open ? setOpened(Date.now()) : undefined)}>
            <DropdownMenuTrigger
              render={<Button ref={opener} variant="outline" size="xs" aria-label="Change when it expires" className="pointer-coarse:-my-2 pointer-coarse:h-9 pointer-coarse:px-3" />}
            >
              Change
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {SPANS.map((days) => (
                <DropdownMenuItem key={days} onClick={() => void choose(sentFor(afterDays(days, opened)))}>
                  <span>{days === 1 ? "1 day" : `${days} days`}</span>
                  <span className="ml-auto text-muted-foreground">{momentIn(afterDays(days, opened))}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={pickDay}>On a day...</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={site.expires === "never"} onClick={() => void choose("never")}>
                Never
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {note === undefined ? null : <p className="text-muted-foreground">{note}</p>}
        {refusal === undefined ? null : (
          <Field invalid>
            <FieldError>{refusal}</FieldError>
          </Field>
        )}
      </div>
      {picks ? (
        <Suspense fallback={null}>
          <ExpiryDayDialog open={picking} onClose={() => setPicking(false)} onSave={saveDay} returnTo={opener} />
        </Suspense>
      ) : null}
    </PanelFact>
  );
}
