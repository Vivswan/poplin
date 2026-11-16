// The Domain screen: one line that says how the domain stands, the two runs beside it, and one row per piece the install needs on the domain.
// On an install without a domain the same screen shows the pieces it has in a domain's place, under one line that says so; the words for both come from the server.
//
//   an install whose check needs no token    opens on its pieces, and checks them again by itself when the last check is none or old; Check asks nothing, and Repair asks for the token
//   an install whose check needs a token     opens on the last run the install remembers; Check and Repair each ask for the token
//
// A token is asked for in a dialog, sent once, and held nowhere. The pieces of a run made here are shown until the screen is left.

import { Dialog as DialogParts } from "@base-ui/react/dialog";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type Domain, type DomainRun, type Ran, useDomain, useDomainPieces } from "@/domain/domain-queries";
import { PersonSteps } from "@/domain/person-steps";
import { Pieces } from "@/domain/pieces";
import { RunDialog } from "@/domain/run-dialog";
import { StatusLine } from "@/domain/status-line";
import type { Sent } from "@/domain/token-run";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { useChosenTimeZone } from "@/lib/timezone";
import { MiddleColumn } from "@/shared/middle-column";
import { HomeProblems } from "@/problems/home-problems";
import { AppShell } from "@/shell/app-shell";

/** What an install that remembers no run, and whose check needs a token, says in place of a count, and small beside it. */
const NEVER = { line: "Not checked yet", says: "Press Check to see every piece." } as const;

/** What stands in place of a count while the first check of an install that checks by itself is on its way, and small beside the count while a later one is. */
const CHECKING = "Checking";

/** What stands in place of a count when such an install's first check read nothing; why is said small beside it. */
const UNREAD = "Not checked";

/** The run the install remembers. */
type Last = NonNullable<Domain["last"]>;

/** The line over the pieces: the count or what stands in its place, how it is read, and what is said small beside it. */
interface Headline {
  readonly line: string;
  readonly tone: "good" | "bad" | "idle";
  readonly beside: ReactNode;
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

/** The rows that stand in the working area while something is read. */
function Reading(): ReactNode {
  return (
    <div className="flex flex-col gap-3 px-6 max-md:px-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/** What stands in the working area while the screen's data is read, or when the read was refused. */
function Waiting({ failure, onAgain }: { readonly failure: string | undefined; readonly onAgain: () => void }): ReactNode {
  if (failure === undefined) return <Reading />;

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

/** Say what a run found, in the words of its count. */
function sayRan(summary: Ran["summary"]): void {
  const said = summary.line.endsWith(".") ? summary.line : `${summary.line}.`;

  if (summary.tone === "good") sayDone(said);
  else sayRefused(said);
}

/** The line over the pieces. A check on its way, or one that read nothing, is said small beside the count of the pieces on show, and in the count's place where none are. */
function headlineOf(domain: Domain, pieces: ReturnType<typeof useDomainPieces>): Headline {
  const { ran, last, checking, failure } = pieces;
  const state = checking ? CHECKING : failure;
  if (ran !== undefined) return { line: ran.summary.line, tone: ran.summary.tone, beside: state ?? (last === undefined ? undefined : <LastRun last={last} />) };

  if (!domain.checks_alone) return { line: NEVER.line, tone: "idle", beside: NEVER.says };

  return checking ? { line: CHECKING, tone: "idle", beside: undefined } : { line: UNREAD, tone: "bad", beside: failure };
}

/** Draw the screen over what it opened with. */
function Opened({ domain }: { readonly domain: Domain }): ReactNode {
  const pieces = useDomainPieces(domain);
  const asks = useMemo(() => DialogParts.createHandle<DomainRun>(), []);
  const { ran, checking } = pieces;
  const { line, tone, beside } = headlineOf(domain, pieces);

  const run = async (kind: DomainRun, sent: Sent): Promise<Refused | undefined> => {
    try {
      const done = await answerOf(api.domain[kind].$post({ json: { token: sent.token } }));
      pieces.take(done);
      asks.close();
      sayRan(done.summary);

      return undefined;
    } catch (refused) {
      if (refused instanceof Refused) return refused;

      throw refused;
    }
  };
  const check = async (): Promise<void> => {
    const done = await pieces.check();
    if (done !== undefined) sayRan(done.summary);
  };

  return (
    <>
      <MiddleColumn gutters className="flex min-h-0 flex-1 flex-col">
        <section aria-label="Domain" className="flex min-h-0 flex-1 flex-col">
          {domain.words.line === null ? null : <p className="shrink-0 px-6 pb-3 text-muted-foreground max-md:px-4">{domain.words.line}</p>}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-3 max-md:px-4">
            <StatusLine line={line} tone={tone} beside={beside} />
            <div className="ml-auto flex items-center gap-2">
              {domain.checks_alone ? (
                <Button variant="outline" disabled={checking} onClick={() => void check()}>
                  {checking ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                  Check
                </Button>
              ) : (
                <DialogTrigger handle={asks} payload="check" render={<Button variant="outline" />}>
                  Check
                </DialogTrigger>
              )}
              <DialogTrigger handle={asks} payload="repair" render={<Button variant={tone === "bad" ? "default" : "outline"} />}>
                Repair
              </DialogTrigger>
            </div>
          </div>
          {ran === undefined || ran.steps.length === 0 ? null : (
            <div className="shrink-0 px-6 pb-3 max-md:px-4">
              <PersonSteps steps={ran.steps} />
            </div>
          )}
          <HomeProblems home="domain" className="flex shrink-0 flex-col gap-2 px-6 pb-3 max-md:px-4" />
          {ran === undefined ? null : <Pieces rows={ran.rows} />}
          {ran === undefined && checking ? <Reading /> : null}
        </section>
      </MiddleColumn>
      <RunDialog handle={asks} form={domain.form} thing={domain.words.thing} onRun={run} />
    </>
  );
}

/** Draw the Domain screen. */
export function DomainScreen(): ReactNode {
  useChosenTimeZone();
  const { data, error, refetch } = useDomain();

  return (
    <AppShell current="domain" heading="Domain">
      {data === undefined ? (
        <MiddleColumn gutters>
          <Waiting failure={error?.message} onAgain={() => void refetch()} />
        </MiddleColumn>
      ) : (
        <Opened domain={data} />
      )}
    </AppShell>
  );
}
