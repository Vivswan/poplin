import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

/** The look of either arrow that shows when the list is longer than its room. */
const SCROLL_ARROW = "z-10 flex w-full cursor-default items-center justify-center bg-popover py-[4px] text-muted-foreground";

/** A select of the UI library; give it `items` so the chosen label shows before the list was ever opened. */
export const Select = SelectPrimitive.Root;

/** The chosen item's label. */
export function SelectValue({ className, ...props }: SelectPrimitive.Value.Props): React.ReactElement {
  return <SelectPrimitive.Value data-slot="select-value" className={cn("text-left", className)} {...props} />;
}

/** The pill that opens the list: what it is given, then the arrow. */
export function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props): React.ReactElement {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "inline-flex min-h-[32px] cursor-pointer items-center gap-[8px] rounded-[8px] border-0 bg-card px-[12px] py-0 text-[0.875rem] leading-[1.3] font-semibold whitespace-nowrap text-foreground",
        "outline-ring hover:inset-ring hover:inset-ring-faint focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className="text-muted-foreground" />} />
    </SelectPrimitive.Trigger>
  );
}

/** The list, in a layer above the page, placed by the library against the trigger. */
export function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props): React.ReactElement {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={4} className="isolate z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-[8px] bg-popover p-[4px]",
            "text-[0.875rem] leading-[1.3] text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow data-slot="select-scroll-up-button" className={cn(SCROLL_ARROW, "top-0")}>
            <ChevronUpIcon />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow data-slot="select-scroll-down-button" className={cn(SCROLL_ARROW, "bottom-0")}>
            <ChevronDownIcon />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

/** One item of the list; the chosen one carries a check. */
export function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props): React.ReactElement {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center rounded-[5px] py-[6px] pr-[32px] pl-[8px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex-1 whitespace-nowrap">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator render={<span className="pointer-events-none absolute right-[8px] flex items-center justify-center" />}>
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
