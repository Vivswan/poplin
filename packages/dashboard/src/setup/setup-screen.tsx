// The setup screen: what a person sees before anyone has logged in. One form takes a token, and on an install with nothing set its domain and first login; one press of Repair makes every piece.
//
// It has no sections at its side and shows nothing of the install until a run's token is proven.

import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { PersonSteps } from "@/domain/person-steps";
import { Pieces } from "@/domain/pieces";
import { StatusLine } from "@/domain/status-line";
import type { Sent } from "@/domain/token-run";
import { answerOf, Refused } from "@/lib/api";
import { SetupForm } from "@/setup/setup-form";
import { type SETUP, type SetupRan, setupApi } from "@/setup/setup-start";
import { BrandMark } from "@/shell/app-shell";

/** What the screen says first, by the boxes its form has. */
const LEADS = {
  first: "Make an account token, fill in three boxes, press Repair.",
  login: "Make an account token, paste it, press Repair.",
} as const;

/** What a repair left: the line that counts the pieces, which logins the install expects, the steps only a person can do, and one row per piece. */
function Result({ ran, head }: { readonly ran: SetupRan; readonly head: Ref<HTMLDivElement> }): ReactNode {
  return (
    <section aria-label="Result" className="flex flex-col">
      <div className="flex flex-col gap-2 px-6 pb-3 max-md:px-4">
        <StatusLine head={head} line={ran.summary.line} tone={ran.summary.tone} />
        {ran.expects === null ? null : <p className="text-muted-foreground">The login is set to expect: {ran.expects}</p>}
        <PersonSteps steps={ran.steps} />
      </div>
      <Pieces rows={ran.rows} />
    </section>
  );
}

/** Draw the setup screen. */
export function SetupScreen({ start }: { readonly start: NonNullable<typeof SETUP> }): ReactNode {
  const [ran, setRan] = useState<SetupRan>();
  const head = useRef<HTMLDivElement>(null);

  // The count's line takes the focus after each run, so the result is where a keyboard and a screen reader are.
  useEffect(() => {
    if (ran !== undefined) head.current?.focus();
  }, [ran]);

  const repair = async (sent: Sent): Promise<Refused | undefined> => {
    try {
      setRan(await answerOf(setupApi.repair.$post({ json: sent })));

      return undefined;
    } catch (refused) {
      if (refused instanceof Refused) return refused;

      throw refused;
    }
  };

  return (
    <div className="flex h-svh flex-col overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-2 px-6 max-md:px-4">
        <BrandMark />
        <span className="text-base font-bold tracking-tight">poplin</span>
      </header>
      <main className="flex w-full flex-col gap-8 pt-6 pb-16">
        <div className="flex flex-col gap-1 px-6 max-md:px-4">
          <h1 className="text-base font-bold">Setup</h1>
          {ran === undefined ? <p className="text-muted-foreground">{LEADS[start.boxes]}</p> : null}
        </div>
        {ran === undefined ? null : <Result ran={ran} head={head} />}
        <div className="px-6 max-md:px-4">
          <SetupForm form={start.form} boxes={start.boxes} onRepair={repair} />
        </div>
      </main>
    </div>
  );
}
