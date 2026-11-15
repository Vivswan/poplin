import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "cn";

const TOGGLE = [
  "block cursor-pointer rounded-[5px] border-0 bg-transparent px-[14px] py-[7px] text-center whitespace-nowrap text-muted-foreground",
  "outline-ring hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
  "aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background",
  "motion-safe:transition-[background-color,color] motion-safe:duration-[180ms] motion-safe:ease-(--ease)",
];

/** A segmented switch of the UI library: its choices share one filled pill, each as wide as the widest. */
export function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props): React.ReactElement {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "inline-grid auto-cols-[1fr] grid-flow-col gap-[3px] rounded-[8px] bg-muted p-[3px] text-[0.875rem] leading-[1.3] font-semibold",
        className,
      )}
      {...props}
    />
  );
}

/** One choice of a segmented switch: muted until pressed, then the page's ink on its ground. */
export function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props): React.ReactElement {
  return <TogglePrimitive data-slot="toggle-group-item" className={cn(TOGGLE, className)} {...props} />;
}
