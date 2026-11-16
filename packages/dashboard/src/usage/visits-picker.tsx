// The control that picks the sites drawn beside all sites: a button that opens a list to search and tick, with the ways to tick every listed site and to clear the ticks.

import { ScrollArea as ScrollAreaParts } from "@base-ui/react/scroll-area";
import { type ReactNode, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LOOK_COUNT, MOST_PICKED, type Option, type Picked, useOptions } from "@/usage/visits-queries";

/** How long the typing rests before the list is read again, in milliseconds. */
const REST = 200;

/** How high the room of the list of sites may be: the library's own height, cut down to whole lines over the 8 px of the list's edges. A line is 28 px, and 40 px under the width at which `index.css` makes it a finger high. */
const WHOLE_LINES =
  "[--line:1.75rem] max-[767.98px]:[--line:2.5rem] *:data-[slot=scroll-area-viewport]:max-h-[calc(round(down,min(15.75rem,var(--available-height)_-_2.25rem)_-_0.5rem,var(--line))_+_0.5rem)]";

/** The list inside that room: the room scrolls it and draws the bar, so the list itself is as high as its sites. */
const UNCUT = "max-h-none overflow-visible";

/** What the picker is drawn from. */
interface VisitsPickerProps {
  /** The sites picked now. */
  readonly picked: readonly Picked[];

  /** Keeps another pick. */
  readonly onPick: (picked: readonly Picked[]) => void;
}

/** The sites after a change of the ticks: a site that stays keeps its look, and a new one takes the first look that is free, or, once all are taken, the next in turn. */
function pickedAfter(before: readonly Picked[], ticked: readonly Option[]): readonly Picked[] {
  const after = before.filter((site) => ticked.some((option) => option.id === site.id));

  for (const option of ticked) {
    if (after.length >= MOST_PICKED) break;

    if (after.some((site) => site.id === option.id)) continue;

    const taken = new Set(after.map((site) => site.slot));
    const free = Array.from({ length: LOOK_COUNT }, (_look, slot) => slot).find((slot) => !taken.has(slot));
    after.push({ id: option.id, title: option.title, slot: free ?? after.length % LOOK_COUNT });
  }

  return after;
}

/** Draw the button and, while it is open, the list. */
export function VisitsPicker({ picked, onPick }: VisitsPickerProps): ReactNode {
  const [typed, setTyped] = useState("");
  const [asked] = useDebounce(typed.trim(), REST);
  const [open, setOpen] = useState(false);
  const { data: options = [], isPlaceholderData } = useOptions(asked, open);
  // While the typing rests and while its answer is read, the list still holds the sites of an earlier text.
  const stale = typed.trim() !== asked || isPlaceholderData;
  const ticked: readonly Option[] = picked.map((site) => ({ id: site.id, title: site.title, name: "" }));
  const full = picked.length >= MOST_PICKED;
  const field = useRef<HTMLInputElement>(null);
  // Clear is turned off once nothing is picked, and a button turned off while it holds the focus drops it to the page: the field takes it first, so the typing after a Clear still finds a site.
  const clear = (): void => {
    field.current?.focus();
    onPick([]);
  };

  return (
    <Combobox
      multiple
      open={open}
      onOpenChange={setOpen}
      items={options}
      filter={null}
      autoHighlight
      value={ticked}
      // Enter over a list from before the typed text would tick a site the text does not find: the key waits for the list of that text.
      onValueChange={(next: readonly Option[], details) => (stale && details.event.type === "keydown" ? details.cancel() : onPick(pickedAfter(picked, next)))}
      inputValue={typed}
      onInputValueChange={setTyped}
      isItemEqualToValue={(item: Option, value: Option) => item.id === value.id}
      itemToStringLabel={(item: Option) => item.title}
    >
      <ComboboxTrigger aria-label="Compare sites" render={<Button type="button" variant="outline" className="gap-1.5 font-normal max-md:min-h-10" />}>
        Compare sites
        {picked.length === 0 ? null : <span className="text-muted-foreground tabular-nums">{picked.length}</span>}
      </ComboboxTrigger>
      <ComboboxContent align="end" aria-label="Compare sites" className="w-72">
        <ComboboxInput ref={field} placeholder="Find a site" aria-label="Find a site" showTrigger={false} />
        <div className="flex items-center gap-1 border-b px-1.5 py-1">
          <Button type="button" variant="ghost" size="xs" disabled={options.length === 0} onClick={() => onPick(pickedAfter(picked, [...ticked, ...options]))}>
            Select all
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={picked.length === 0} onClick={clear}>
            Clear
          </Button>
        </div>
        <ComboboxEmpty>No site found.</ComboboxEmpty>
        <ScrollArea className={WHOLE_LINES}>
          {/* The bar follows the size of this part: without it a list that another text made shorter keeps the bar of the longer one. */}
          <ScrollAreaParts.Content>
            <ComboboxList aria-label="Sites" className={UNCUT}>
              {(option: Option) => (
                <ComboboxItem key={option.id} value={option} disabled={full && !picked.some((site) => site.id === option.id)}>
                  <span className="min-w-0 truncate">{option.title}</span>
                  {option.title === option.name ? null : <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">{option.name}</span>}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ScrollAreaParts.Content>
        </ScrollArea>
        {full ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">{MOST_PICKED} sites at most.</p> : null}
      </ComboboxContent>
    </Combobox>
  );
}
