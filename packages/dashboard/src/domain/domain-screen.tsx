// The Domain screen: one line that says how the domain stands, the two runs beside it, and one row per piece the install needs on the domain.
//
// It opens on the last run the install remembers. A run is made from a dialog that asks for the token, which is sent once and held nowhere; its pieces are shown until the screen is left.

import { Dialog as DialogParts } from "@base-ui/react/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DOMAIN_KEY, type Domain, type Ran, useDomain } from "@/domain/domain-queries";
import { PersonSteps } from "@/domain/person-steps";
import { Pieces } from "@/domain/pieces";
import { RunDialog } from "@/domain/run-dialog";
import { StatusLine } from "@/domain/status-line";
import type { Sent } from "@/domain/token-run";
import { answerOf, api, Refused } from "@/lib/api";
import { FRAME_KEY } from "@/lib/frame";
import { sayDone, sayRefused } from "@/lib/notify";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { useChosenTimeZone } from "@/lib/timezone";
import { AppShell } from "@/shell/app-shell";

/** What an install that remembers no run says in place of a count, and small beside it. */
const NEVER = { line: "Not checked yet", says: "Press Check to see every piece." } as const;

/** The run the install remembers. */
type Last = NonNullable<Domain["last"]>;

/** A run made here, and when the run the install remembered before it was: the remembered run is said beside the count only once it is this one. */
interface Made {
  readonly ran: Ran;
  readonly before: number | undefined;
}

/** When the remembered run was and who ran it; a run too old to go by says so. */
function LastRun({ last }: { readonly last: Last }): ReactNode {
  return (
    <>
      {last.run === "check" ? "Checked" : "Repaired"}{" "}
      <time dateTime={new Date(last.ran_at).toISOString()} title={wholeMoment(last.ran_at)}>
        {shortMoment(last.ran_at)}
      </time>{" "}
      by {last.by}
      {last.stale ? ". Check again." : null}
    </>
  );
}

/** What stands in the working area while the screen's data is read, or when the read was refused. */
function Waiting({ failure, onAgain }: { readonly failure: string | undefined; readonly onAgain: () => void }): ReactNode {
  if (failure === undefined) {
    return (
      <div className="flex flex-col gap-3 px-6 max-md:px-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  return (
    <Empty className="flex-none py-16">
      <EmptyHeader>
        <EmptyTitle>{failure}</EmptyTitle>
      </EmptyHeader>
      <Button variant="outline" onClick={onAgain}>
        Try again
      </Button>
    </Empty>
  );
}

/** What the screen shows of the domain: the run made here, else the last run the install remembers, else that there was none. */
function shownOf(ran: Ran | undefined, last: Domain["last"]): { readonly line: string; readonly tone: "good" | "bad" | "idle"; readonly rows?: Ran["rows"] } {
  const known = ran ?? last;
  if (known === null) return { line: NEVER.line, tone: "idle" };

  return { line: known.summary.line, tone: known.summary.tone, rows: known.rows };
}

/** Say what a run found, in the words of its count. */
function sayRan(summary: Ran["summary"]): void {
  if (summary.tone === "good") sayDone(`${summary.line}.`);
  else sayRefused(`${summary.line}.`);
}

/** Draw the Domain screen. */
export function DomainScreen(): ReactNode {
  useChosenTimeZone();
  const client = useQueryClient();
  const { data, error, refetch } = useDomain();
  const [made, setMade] = useState<Made>();
  const asks = useMemo(() => DialogParts.createHandle<Ran["run"]>(), []);

  const run = async (kind: Ran["run"], sent: Sent): Promise<Refused | undefined> => {
    try {
      const done = await answerOf(api.domain[kind].$post({ json: { token: sent.token } }));
      setMade({ ran: done, before: data?.last?.ran_at });
      asks.close();
      sayRan(done.summary);
      void client.invalidateQueries({ queryKey: DOMAIN_KEY });
      // The side says what the domain needs, which a run changes.
      void client.invalidateQueries({ queryKey: FRAME_KEY });

      return undefined;
    } catch (refused) {
      if (refused instanceof Refused) return refused;

      throw refused;
    }
  };

  if (data === undefined) {
    return (
      <AppShell current="domain" heading="Domain">
        <Waiting failure={error?.message} onAgain={() => void refetch()} />
      </AppShell>
    );
  }

  const ran = made?.ran;
  const { line, tone, rows } = shownOf(ran, data.last);
  const read = data.last !== null && (made === undefined || data.last.ran_at !== made.before) ? data.last : undefined;
  const never = rows === undefined ? NEVER.says : undefined;

  return (
    <AppShell current="domain" heading="Domain">
      <section aria-label="Domain" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-3 max-md:px-4">
          <StatusLine line={line} tone={tone} beside={read === undefined ? never : <LastRun last={read} />} />
          <div className="ml-auto flex items-center gap-2">
            <DialogTrigger handle={asks} payload="check" render={<Button variant="outline" />}>
              Check
            </DialogTrigger>
            <DialogTrigger handle={asks} payload="repair" render={<Button />}>
              Repair
            </DialogTrigger>
          </div>
        </div>
        {ran === undefined || ran.steps.length === 0 ? null : (
          <div className="shrink-0 px-6 pb-3 max-md:px-4">
            <PersonSteps steps={ran.steps} />
          </div>
        )}
        {rows === undefined ? null : <Pieces rows={rows} />}
      </section>
      <RunDialog handle={asks} form={data.form} onRun={run} />
    </AppShell>
  );
}
