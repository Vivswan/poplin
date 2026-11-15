// The control that picks the sites drawn beside all sites: a button that opens a list to search and tick, up to five at once.

import { type ReactNode, useState } from "react";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { MOST_PICKED, type Option, type Picked, SLOTS, useOptions } from "@/usage/visits-queries";

/** How long the typing rests before the list is read again, in milliseconds. */
const REST = 200;

/** What the picker is drawn from. */
interface VisitsPickerProps {
  /** The sites picked now. */
  readonly picked: readonly Picked[];

  /** Keeps another pick. */
  readonly onPick: (picked: readonly Picked[]) => void;
}

/** The sites after a change of the ticks: a site that stays keeps its colour, and a new one takes the first colour that is free. */
function pickedAfter(before: readonly Picked[], ticked: readonly Option[]): readonly Picked[] {
  const after = before.filter((site) => ticked.some((option) => option.id === site.id));

  for (const option of ticked) {
    if (after.length >= MOST_PICKED) break;

    if (after.some((site) => site.id === option.id)) continue;

    const taken = new Set(after.map((site) => site.slot));
    after.push({ id: option.id, title: option.title, slot: SLOTS.find((slot) => !taken.has(slot)) ?? SLOTS[0] });
  }

  return after;
}

/** Draw the button and, while it is open, the list. */
export function VisitsPicker({ picked, onPick }: VisitsPickerProps): ReactNode {
  const [typed, setTyped] = useState("");
  const [asked] = useDebounce(typed.trim(), REST);
  const [open, setOpen] = useState(false);
  const { data: options = [] } = useOptions(asked, open);
  const ticked: readonly Option[] = picked.map((site) => ({ id: site.id, title: site.title, name: "" }));
  const full = picked.length >= MOST_PICKED;

  return (
    <Combobox
      multiple
      open={open}
      onOpenChange={setOpen}
      items={options}
      filter={null}
      value={ticked}
      onValueChange={(next: readonly Option[]) => onPick(pickedAfter(picked, next))}
      inputValue={typed}
      onInputValueChange={setTyped}
      isItemEqualToValue={(item: Option, value: Option) => item.id === value.id}
      itemToStringLabel={(item: Option) => item.title}
    >
      <ComboboxTrigger aria-label="Compare sites" render={<Button type="button" variant="outline" className="gap-1.5 font-normal max-md:min-h-10" />}>
        Compare sites
        {picked.length === 0 ? null : <span className="text-muted-foreground tabular-nums">{picked.length}</span>}
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-72">
        <ComboboxInput placeholder="Find a site" aria-label="Find a site" showTrigger={false} />
        <ComboboxEmpty>No site found.</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) => (
            <ComboboxItem key={option.id} value={option} disabled={full && !picked.some((site) => site.id === option.id)}>
              <span className="min-w-0 truncate">{option.title}</span>
              {option.title === option.name ? null : <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">{option.name}</span>}
            </ComboboxItem>
          )}
        </ComboboxList>
        {full ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">{MOST_PICKED} sites at most.</p> : null}
      </ComboboxContent>
    </Combobox>
  );
}
