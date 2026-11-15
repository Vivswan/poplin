// The setup screen: what a person sees before anyone has logged in. One form takes a token, and on an install with nothing set its domain and first login; one press of Repair makes every piece.
//
// It has no sections at its side and shows nothing of the install until a run's token is proven.

import { type ReactNode, useEffect, useRef, useState } from "react";

import { Pieces } from "@/domain/pieces";
import { type Sent, TokenForm } from "@/domain/token-form";
import { answerOf, Refused } from "@/lib/api";
import { type SETUP, type SetupRan, setupApi } from "@/setup/setup-start";
import { BrandMark } from "@/shell/app-shell";

/** What the screen says first, by the boxes its form has. */
const LEADS = {
  first: "This install is new. Make a token, fill in the three boxes, and press Repair.",
  login: "Nobody has logged in here yet. Make a token, paste it, and press Repair.",
} as const;

/** Draw the setup screen. */
export function SetupScreen({ start }: { readonly start: NonNullable<typeof SETUP> }): ReactNode {
  const [ran, setRan] = useState<SetupRan>();
  const head = useRef<HTMLDivElement>(null);

  // The count's line takes the focus after each run, so the result is where a keyboard and a screen reader are.
  useEffect(() => {
    if (ran !== undefined) head.current?.focus();
  }, [ran]);

  const run = async (kind: SetupRan["run"], sent: Sent): Promise<Refused | undefined> => {
    try {
      setRan(await answerOf(setupApi[kind].$post({ json: sent })));

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
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 pt-6 pb-16">
        <div className="flex flex-col gap-1 px-6 max-md:px-4">
          <h1 className="text-base font-bold">Setup</h1>
          <p className="text-muted-foreground">{LEADS[start.boxes]}</p>
        </div>
        <div className="px-6 max-md:px-4">
          <TokenForm form={start.form} boxes={start.boxes} onRun={run} />
        </div>
        {ran === undefined ? null : (
          <Pieces
            head={head}
            summary={ran.summary}
            rows={ran.rows}
            steps={ran.steps}
            under={ran.expects === null ? undefined : `The login is set to expect: ${ran.expects}`}
          />
        )}
      </main>
    </div>
  );
}
