// The Domain screen: the token block that checks and repairs, one row per piece the install needs on the domain, and the three settings of what the domain lets in.
//
// It opens on the last run the install remembers. A run made here is shown in its place until the screen is left: its token is sent once and held nowhere.

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DOMAIN_KEY, type Domain, type Ran, useDomain } from "@/domain/domain-queries";
import { Guards } from "@/domain/guards";
import { Pieces } from "@/domain/pieces";
import { type Sent, TokenForm } from "@/domain/token-form";
import { answerOf, api, Refused } from "@/lib/api";
import { FRAME_KEY } from "@/lib/frame";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { AppShell } from "@/shell/app-shell";

/** What stands where the rows would on an install that remembers no run. */
const NEVER = {
  title: "Not checked yet",
  says: "This install keeps records, routes, a login, and rules on your domain. A token shows every piece, and repairs one that is missing or changed.",
} as const;

/** The run the install remembers. */
type Last = NonNullable<Domain["last"]>;

/** When the remembered run was and who ran it; a run too old to go by says so. */
function LastRun({ last }: { readonly last: Last }): ReactNode {
  return (
    <>
      {last.run === "check" ? "Checked" : "Repaired"}{" "}
      <time dateTime={new Date(last.ran_at).toISOString()} title={wholeMoment(last.ran_at)}>
        {shortMoment(last.ran_at)}
      </time>{" "}
      by {last.by}
      {last.stale ? ". Over 30 days old: press Check." : null}
    </>
  );
}

/** What stands in the working area while the screen's data is read, or when the read was refused. */
function Waiting({ failure, onAgain }: { readonly failure: string | undefined; readonly onAgain: () => void }): ReactNode {
  if (failure === undefined) {
    return (
      <div className="flex flex-col gap-3 px-6 max-md:px-4">
        <Skeleton className="h-40 w-full" />
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

/** The pieces as the screen knows them: after the run made here, else as the install remembers its last run, else the words of an install that was never checked. */
function Result({ ran, last, head }: { readonly ran: Ran | undefined; readonly last: Domain["last"]; readonly head: Ref<HTMLDivElement> }): ReactNode {
  if (ran !== undefined) return <Pieces head={head} summary={ran.summary} rows={ran.rows} steps={ran.steps} />;

  if (last !== null) return <Pieces summary={last.summary} rows={last.rows} steps={[]} beside={<LastRun last={last} />} />;

  return (
    <Empty className="flex-none rounded-none border-y border-solid py-10">
      <EmptyHeader className="max-w-lg">
        <EmptyTitle>{NEVER.title}</EmptyTitle>
        <EmptyDescription>{NEVER.says}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Draw the Domain screen. */
export function DomainScreen(): ReactNode {
  const client = useQueryClient();
  const { data, error, refetch } = useDomain();
  const [ran, setRan] = useState<Ran>();
  const head = useRef<HTMLDivElement>(null);

  // The count's line takes the focus after each run, so the result is where a keyboard and a screen reader are.
  useEffect(() => {
    if (ran !== undefined) head.current?.focus();
  }, [ran]);

  const run = async (kind: Ran["run"], sent: Sent): Promise<Refused | undefined> => {
    try {
      setRan(await answerOf(api.domain[kind].$post({ json: { token: sent.token } })));
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

  return (
    <AppShell current="domain" heading="Domain">
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-10">
        <div className="px-6 pt-1 max-md:px-4">
          <TokenForm form={data.form} onRun={run} />
        </div>
        <Result ran={ran} last={data.last} head={head} />
        <Guards guards={data.guards} />
      </div>
    </AppShell>
  );
}
