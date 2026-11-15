import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
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
      },
    },
  },
);

/** A button of the UI library in the site's look; `variant` and `size` are both required, since the site has no default button. */
export function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & Required<VariantProps<typeof buttonVariants>>): React.ReactElement {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
