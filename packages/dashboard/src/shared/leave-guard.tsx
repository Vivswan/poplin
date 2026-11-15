// The question before a screen with unsaved typing is left: a move inside the console waits for the answer, and the browser asks its own question before the tab closes or loads again.

import { useBlocker } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Confirm } from "@/shared/confirm";

/** The question a held move waits behind. */
const LEAVE = {
  title: "Leave without saving?",
  says: "You have unsaved changes.",
  yes: "Leave",
  no: "Stay",
  rather: true,
} as const;

/** Say whether a move leaves the screen. A move to another query of the same screen does not. */
function leaves({ current, next }: { readonly current: { readonly pathname: string }; readonly next: { readonly pathname: string } }): boolean {
  return current.pathname !== next.pathname;
}

/**
 * Guard the screen it is drawn on.
 *
 * After Stay the address is the screen's own again, also where Back had changed it already.
 *
 * @param unsaved - whether the screen holds changes that leaving would drop; while `false` nothing is asked
 */
export function LeaveGuard({ unsaved }: { readonly unsaved: boolean }): ReactNode {
  const held = useBlocker({ shouldBlockFn: leaves, disabled: !unsaved, withResolver: true });

  return <Confirm question={held.status === "blocked" ? LEAVE : undefined} onAnswer={(leave) => (leave ? held.proceed?.() : held.reset?.())} />;
}
