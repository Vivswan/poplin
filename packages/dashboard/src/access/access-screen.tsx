// The Access screen: the logins that wait to be allowed, the people who can log in, and the computers and agents that publish with a token. A waiting login is reviewed in a dialog over the lists.

import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useRef } from "react";

import { accessActions } from "@/access/access-actions";
import { ACCESS_KEY, useReview, useWaiting } from "@/access/access-queries";
import { ACCESS_PATH, askedIn, tokenSortOf, tokenSortQuery } from "@/access/access-values";
import { PeopleList } from "@/access/people-list";
import { ReviewDialog } from "@/access/review-dialog";
import { TokensTable } from "@/access/tokens-table";
import { WaitingLogins } from "@/access/waiting-logins";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { searchOf, useAddressQuery } from "@/lib/address";
import { AppShell } from "@/shell/app-shell";

/** The keys of the address the lists keep while a review opens and closes: the order of the tokens. */
const KEPT_KEYS = ["sort", "dir"] as const;

/** The query of the lists alone, without what a review was opened with. */
function listQuery(query: URLSearchParams): URLSearchParams {
  return new URLSearchParams(KEPT_KEYS.flatMap((key) => (query.has(key) ? [[key, query.get(key) ?? ""]] : [])));
}

/** Draw the Access screen for the address: the lists, and the review the path or a terminal's code names. */
export function AccessScreen(): ReactNode {
  const navigate = useNavigate();
  const query = useAddressQuery();
  const allows = useMatches({ select: (matches) => matches.some((match) => match.fullPath === ALLOW_PAGE) });
  const { login } = useParams({ strict: false });
  const asked = askedIn(allows, query, login);
  const client = useQueryClient();
  // The login under review is not read again after a change: a read by code is a counted try, and the review closes anyway.
  const actions = useMemo(
    () => accessActions(() => void client.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === ACCESS_KEY[0] && queryKey[1] !== "review" })),
    [client],
  );
  const review = useReview(asked);
  // A code that names no login tells nothing of the logins that do wait: they are neither read nor drawn from an earlier read.
  const listed = asked?.by !== "code" || review.data !== undefined;
  const waiting = useWaiting(listed);
  const kept = listQuery(query);
  const opener = useRef<HTMLElement | null>(null);
  const openReview = (id: string): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void navigate({ to: "/tokens/review/$login", params: { login: id }, search: searchOf(kept) });
  };
  const sort = tokenSortOf(query);

  return (
    <AppShell current="access" heading="Access">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-8">
        {asked !== undefined && review.error !== null ? (
          <div className="px-6 max-md:px-4">
            <Alert role="status">
              <AlertDescription>{review.error.message}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {listed ? <WaitingLogins waiting={waiting.data} failure={waiting.error?.message} onReview={(login) => openReview(login.id)} /> : null}
        <PeopleList actions={actions} />
        <TokensTable actions={actions} sort={sort} onSort={(next) => void navigate({ to: ACCESS_PATH, search: searchOf(tokenSortQuery(next)) })} />
      </div>
      <ReviewDialog
        login={asked === undefined ? undefined : review.data}
        actions={actions}
        onClose={() => void navigate({ to: ACCESS_PATH, search: searchOf(kept), replace: true })}
        returnTo={opener}
      />
    </AppShell>
  );
}
