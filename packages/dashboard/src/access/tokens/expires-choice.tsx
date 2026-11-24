// When a token expires, where a person chooses it: the picker with a token's spans and words, and what an admin token that never expires is told.

import type { ReactNode } from "react";

import type { Token } from "@/access/access-queries";
import type { Expiry } from "@/dialog/expiry/expiry-moments";
import { ExpiryPicker } from "@/dialog/expiry/expiry-picker";

/** The spans a person chooses between, in days from the moment the menu opened. */
const SPANS = [30, 90, 365] as const;

/** What the calendar says of the day that is picked. A day that has passed cannot be picked: revoking is what ends a token now. */
const DAY_SAYS = "The token stops working when that day starts. To end it now, revoke it.";

/** What is said under an admin token that never expires. */
const NEVER_SAYS = "It works until you revoke it.";

/** What the choice is drawn from. */
interface ExpiresChoiceProps {
  /** When the token expires as it is chosen now. */
  readonly expires: Expiry;

  /** The role of the token: an admin token that never expires is told what that means. */
  readonly scope: Token["scope"];

  /** Called with another choice. */
  readonly onChoose: (expires: Expiry) => void;
}

/** Draw when a token expires, with the button that sets another moment or never. A choice saves nothing by itself: the form around it does. */
export function ExpiresChoice({ expires, scope, onChoose }: ExpiresChoiceProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ExpiryPicker expires={expires} spans={SPANS} daySays={DAY_SAYS} onChoose={onChoose} />
      {scope === "admin" && expires === "never" ? <p className="text-[13px] text-muted-foreground">{NEVER_SAYS}</p> : null}
    </div>
  );
}
