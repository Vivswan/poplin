// The logins that wait to be allowed, as plain rows above the lists: who asks, for what, and since when. A row opens the review; no row shows a code.

import type { ReactNode } from "react";

import type { useWaiting, WaitingLogin } from "@/access/access-queries";
import { AccessSection, InsteadOfRows } from "@/access/access-section";
import { computerName, SCOPE_WORDS } from "@/access/access-values";
import { Button } from "@/components/ui/button";
import { shortMoment, wholeMoment } from "@/lib/sites";

/** What the block is drawn from. */
interface WaitingLoginsProps {
  /** The newest waiting logins and how many more wait; `undefined` while they are being read. */
  readonly waiting: ReturnType<typeof useWaiting>["data"];

  /** The sentence of a read that was refused. */
  readonly failure: string | undefined;

  /** Opens the review of one login. */
  readonly onReview: (login: WaitingLogin) => void;
}

function WaitingRow({ login, onReview }: { readonly login: WaitingLogin; readonly onReview: (login: WaitingLogin) => void }): ReactNode {
  const name = computerName(login.computer);

  return (
    <li className="flex min-h-11 items-center gap-3 border-b px-6 hover:bg-muted max-md:min-h-16 max-md:px-4 max-md:py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate" title={name.whole}>
          <span className="font-medium">{name.shown}</span> <span className="text-muted-foreground">asks to log in</span>
        </span>
        <span className="truncate text-[13px] text-muted-foreground md:hidden">
          {SCOPE_WORDS[login.scope]}, {shortMoment(login.asked)}
        </span>
      </span>
      <span className="w-40 shrink-0 truncate text-muted-foreground max-md:hidden">{SCOPE_WORDS[login.scope]}</span>
      <time
        dateTime={new Date(login.asked).toISOString()}
        title={wholeMoment(login.asked)}
        className="w-28 shrink-0 truncate text-muted-foreground max-md:hidden"
      >
        {shortMoment(login.asked)}
      </time>
      <Button variant="outline" size="sm" aria-label={`Review ${name.shown}`} onClick={() => onReview(login)}>
        Review
      </Button>
    </li>
  );
}

/** Draw the waiting logins. With none waiting, and while they are being read, nothing is drawn; a read that was refused says so. */
export function WaitingLogins({ waiting, failure, onReview }: WaitingLoginsProps): ReactNode {
  if (failure !== undefined) {
    return (
      <AccessSection title="Waiting" says="to be allowed or denied">
        <InsteadOfRows failure={failure} />
      </AccessSection>
    );
  }

  if (waiting === undefined || waiting.logins.length === 0) return null;

  const { logins, more } = waiting;

  return (
    <AccessSection title="Waiting" count={logins.length + more} says="to be allowed or denied">
      <ul aria-label="Waiting logins" className="border-t">
        {logins.map((login) => (
          <WaitingRow key={login.id} login={login} onReview={onReview} />
        ))}
      </ul>
      {more === 0 ? null : (
        <p className="px-6 py-2 text-[13px] text-muted-foreground max-md:px-4">{more === 1 ? "1 more is waiting." : `${more} more are waiting.`}</p>
      )}
    </AccessSection>
  );
}
