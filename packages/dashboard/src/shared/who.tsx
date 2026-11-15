// Who did something, written the same way on every screen: a person by email, a login by the name it was given.

import { cn } from "cn";
import { KeyRoundIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The name of each login that has one, by the login's id. */
export type LoginNames = Readonly<Record<string, string>>;

/**
 * Write who did something: a person's email, or a login's name behind the mark of a login.
 *
 * @param by - an email, or a login's id
 * @param logins - the names of the logins there are; a login with no name, or one that was removed, is written by its id
 */
export function Who({ by, logins, className }: { readonly by: string; readonly logins: LoginNames; readonly className?: string }): ReactNode {
  if (by.includes("@")) {
    return (
      <span className={className} title={by}>
        {by}
      </span>
    );
  }

  const name = logins[by];

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 align-bottom", className)} title={name ?? `Token ${by}`}>
      <KeyRoundIcon className="size-3.5 shrink-0 text-faint" aria-label="Token" />
      {name === undefined ? <span className="truncate font-mono text-xs">{by}</span> : <span className="truncate">{name}</span>}
    </span>
  );
}
