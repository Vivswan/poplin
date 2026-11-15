// The question before a change that cannot be taken back with one press: what will happen, a button that does it, and Cancel.

import { type ReactNode, useRef } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** What a question says. */
export interface Question {
  /** The question itself. */
  readonly title: string;

  /** What the change does, in a sentence or two. */
  readonly says: string;

  /** The words of the button that does it. */
  readonly yes: string;

  /** The words of the button that does not; "Cancel" when left out. */
  readonly no?: string;

  /** `true` for a change that removes something: the button is drawn as one. */
  readonly removes?: boolean;
}

/**
 * Ask a question.
 *
 * @param question - the question to show; `undefined` shows none
 * @param onAnswer - called once: `true` when the change is to be done. Escape and a press outside answer `false`
 */
export function Confirm({ question, onAnswer }: { readonly question: Question | undefined; readonly onAnswer: (yes: boolean) => void }): ReactNode {
  // The words stay while the dialog closes, so it does not empty as it fades.
  const last = useRef(question);
  if (question !== undefined) last.current = question;

  const shown = question ?? last.current;

  return (
    <AlertDialog open={question !== undefined} onOpenChange={(open) => (open ? undefined : onAnswer(false))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown?.says}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{shown?.no ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction variant={shown?.removes === true ? "destructive" : "default"} onClick={() => onAnswer(true)}>
            {shown?.yes}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
