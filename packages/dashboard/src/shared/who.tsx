// Who did something, written the same way on every screen: a person by email, a login by the name it was given.

import { cn } from "cn";
import { KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The name of each login that has one, by the login's id. */
export type LoginNames = Readonly<Record<string, string>>;

/** What a `Who` is drawn from. */
interface WhoProps {
  /** An email, or a login's id. */
  readonly by: string;

  /** The names of the logins there are. */
  readonly logins: LoginNames;

  /** What stands for a login with no name left, such as "a token". Left out, such a login is written by its id. */
  readonly unnamed?: string;

  /** Classes laid over its own. */
  readonly className?: string;
}

/** Write who did something: a person's email, or a login's name behind the mark of a login. */
export function Who({ by, logins, unnamed, className }: WhoProps): ReactNode {
  if (by.includes("@")) {
    return (
      <span className={className} title={by}>
        {by}
      </span>
    );
  }

  const words = logins[by] ?? unnamed;

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 align-bottom", className)} title={words ?? `Token ${by}`}>
      <KeyRoundIcon className="size-3.5 shrink-0 text-faint" aria-label="Token" />
      <span className={cn("truncate", words === undefined && "font-mono text-xs")}>{words ?? by}</span>
    </span>
  );
}
