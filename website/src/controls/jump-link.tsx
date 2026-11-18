import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { buttonVariants } from "../ui/button.tsx";

interface Props {
  /** The name of the part of this page the link moves to. */
  to: string;

  /** The words of the link. */
  children: React.ReactNode;
}

/** A quiet link to a part of the same page, set as the trigger of a fold is. Its ink is marked important, since the site's own rule for a link outranks the library's classes. */
export function JumpLink({ to, children }: Props): React.ReactElement {
  return (
    <a href={`#${to}`} className={cn(buttonVariants({ variant: "ghost", size: "line" }), "text-muted-foreground! hover:text-foreground!")}>
      <ChevronRightIcon />
      {children}
    </a>
  );
}
