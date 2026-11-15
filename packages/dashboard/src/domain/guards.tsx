// The three settings of what the domain lets in: two switches and one choice. Each is stored the moment it is changed; the next repair carries it to the domain.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId } from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DOMAIN_KEY, DOMAIN_SAVES_KEY, type Domain } from "@/domain/domain-queries";
import { answerOf, api } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { RowFrame } from "@/settings/row-frame";

/** What blocking bots can be set to, as the setting's own values: the note under it names them. */
const BOTS = [
  { value: "auto", label: "auto" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
] as const;

/** What every save of the three settings shares: they are sent one after another, in the order they were made, so the last choice is the one stored. */
const IN_ORDER = { id: "domain-guards" } as const;

/** The three settings as they are stored. */
type Values = Domain["guards"]["values"];

/**
 * Draw the three settings.
 *
 * A change shows at once and is sent; once every change on its way has its answer the stored values are read again, so a refused one goes back to what is stored.
 * Changes are sent one after another, so the last one made is the one kept. The line that says it was saved offers Undo, which stores the value before.
 */
export function Guards({ guards }: { readonly guards: Domain["guards"] }): ReactNode {
  const id = useId();
  const client = useQueryClient();
  const { values, notes } = guards;

  const shown = (change: Partial<Values>): void => {
    client.setQueryData<Domain>(DOMAIN_KEY, (kept) =>
      kept === undefined ? kept : { ...kept, guards: { ...kept.guards, values: { ...kept.guards.values, ...change } } },
    );
  };
  const saving = useMutation({
    scope: IN_ORDER,
    mutationKey: DOMAIN_SAVES_KEY,
    mutationFn: (change: Partial<Values>) => answerOf(api.domain.settings.$post({ json: change })),
    onError: (refused) => sayRefused(refused.message),
    // What is stored is read again once the last save of a run of them has its answer: a read made earlier would undo, on the screen, a change that is still on its way.
    onSettled: () => (client.isMutating({ mutationKey: DOMAIN_SAVES_KEY }) === 1 ? client.invalidateQueries({ queryKey: DOMAIN_KEY }) : undefined),
  });

  const save = (change: Partial<Values>): void => {
    // Read where the screen's data is kept, so an Undo pressed later takes back from what is shown then.
    const stored = client.getQueryData<Domain>(DOMAIN_KEY)?.guards.values ?? values;
    const before = Object.fromEntries(Object.keys(change).map((key) => [key, stored[key as keyof Values]])) as Partial<Values>;
    shown(change);
    // Undo stores the values from before and says so, with no Undo of its own: as a switch of the Settings screen does.
    const putBack = (): void => {
      shown(before);
      saving.mutate(before, { onSuccess: () => sayDone("Put back.") });
    };
    saving.mutate(change, { onSuccess: () => sayDone("Saved. The next Repair carries it to the domain.", { run: putBack }) });
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col">
      <h2 id={`${id}-title`} className="px-6 pb-3 font-medium max-md:px-4">
        What the domain lets in
      </h2>
      <div className="border-t">
        <RowFrame controlId={`${id}-outside`} label="Let outside pages in" meaning={notes.outside_pages}>
          <span className="flex h-8 items-center">
            <Switch
              id={`${id}-outside`}
              checked={values.outside_pages === "allowed"}
              onCheckedChange={(on) => save({ outside_pages: on ? "allowed" : "blocked" })}
            />
          </span>
        </RowFrame>
        <RowFrame controlId={`${id}-search`} label="Let search engines in" meaning={notes.search_engines_allowed}>
          <span className="flex h-8 items-center">
            <Switch id={`${id}-search`} checked={values.search_engines_allowed} onCheckedChange={(on) => save({ search_engines_allowed: on })} />
          </span>
        </RowFrame>
        <RowFrame controlId={`${id}-bots`} label="Block bots" meaning={notes.block_bots}>
          <Select items={BOTS} value={values.block_bots} onValueChange={(value) => save({ block_bots: value as Values["block_bots"] })}>
            <SelectTrigger id={`${id}-bots`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              <SelectGroup>
                {BOTS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </RowFrame>
      </div>
    </section>
  );
}
