import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "cn";

/** A fold of the UI library: a trigger, and a panel it opens and closes. */
export function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props): React.ReactElement {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/** What opens and closes the fold; an icon in it turns a quarter while the panel is open. */
export function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props): React.ReactElement {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" className={cn("data-panel-open:[&_svg]:rotate-90", className)} {...props} />;
}

/** The folded panel. */
export function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props): React.ReactElement {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}
