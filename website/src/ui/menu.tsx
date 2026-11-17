import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

/** A menu of the UI library: a button that opens a short list, which the keyboard walks and Escape closes. */
export const Menu = MenuPrimitive.Root;

/** The button that opens the list, in the look of the links beside it: what it is given, then the arrow. */
export function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger
      data-slot="menu-trigger"
      className={cn(
        "inline-flex cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] leading-[inherit] text-inherit",
        "outline-ring hover:underline hover:decoration-1 hover:underline-offset-[0.2em] focus-visible:outline-2 focus-visible:outline-offset-4 [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="text-muted-foreground" />
    </MenuPrimitive.Trigger>
  );
}

/** The list, in a layer above the page, placed by the library against the button and kept inside the window. */
export function MenuContent({ className, ...props }: MenuPrimitive.Popup.Props): React.ReactElement {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={8} align="start" collisionPadding={12} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            "z-50 min-w-(--anchor-width) origin-(--transform-origin) rounded-[8px] bg-popover p-[4px]",
            "text-[0.875rem] leading-[1.3] text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

/** One item of the list that is a link: choosing it goes to its address. */
export function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.LinkItem
      data-slot="menu-link-item"
      closeOnClick
      className={cn(
        "flex cursor-pointer items-center rounded-[5px] px-[10px] py-[7px] whitespace-nowrap text-inherit no-underline outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
