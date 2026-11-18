import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/** The site's looks of a button, as class names: for a link set as a button is, which stays a link. */
export const buttonVariants = cva(
  "group/button shrink-0 cursor-pointer border-0 text-[0.8125rem] leading-none font-semibold whitespace-nowrap [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        secondary: "bg-card text-link hover:text-foreground",
        ghost: "bg-transparent text-muted-foreground hover:text-foreground",
      },
      size: {
        sm: "inline-grid h-[28px] place-items-center rounded-[6px] px-[8px] py-0",
        icon: "grid size-[40px] place-items-center rounded-[6px] p-0",
        line: "inline-flex items-center gap-[6px] rounded-[4px] p-0 text-[0.875rem] leading-[1.5] font-normal no-underline [&_svg]:-ml-[2px]",
      },
    },
  },
);

/** A button of the UI library in the site's look; `variant` and `size` are both required, since the site has no default button. */
export function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & Required<VariantProps<typeof buttonVariants>>): React.ReactElement {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
