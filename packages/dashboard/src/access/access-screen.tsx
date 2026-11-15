// The Access screen: two tabs, the people who can log in and the tokens that computers and agents publish with, each one list. A waiting login stands among the tokens and is reviewed in a dialog over them.

import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { type ReactNode, useMemo, useRef } from "react";

import { accessActions } from "@/access/access-actions";
import { ACCESS_KEY, useEndedTokens, usePeople, useReview, useTokens, useWaiting } from "@/access/access-queries";
import { askedIn, TOKENS_PATH, PEOPLE_PATH, tokenSortOf, tokenSortQuery } from "@/access/access-values";
import { useFocusHome } from "@/lib/focus";
import { PeopleTab } from "@/access/people-tab";
import { ReviewDialog } from "@/access/review-dialog";
import { TokensTab } from "@/access/tokens-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DOMAIN_KEY } from "@/domain/domain-queries";
import { searchOf, useAddressQuery } from "@/lib/address";
import { FRAME_KEY } from "@/lib/frame";
import { useChosenTimeZone } from "@/lib/timezone";
import { ScreenTabs } from "@/shared/screen-tabs";
import { AppShell } from "@/shell/app-shell";

/** The keys of the address the tokens keep while a review opens and closes: their order. */
const KEPT_KEYS = ["sort", "dir"] as const;

/** The path of each tab. */
const TAB_PATHS = { people: PEOPLE_PATH, tokens: TOKENS_PATH } as const;

/** The tabs of the screen, in the order shown. */
const TABS = [
  { id: "people", label: "Users" },
  { id: "tokens", label: "Tokens" },
] as const;

/** The query of the tokens alone, without what a review was opened with. */
function listQuery(query: URLSearchParams): URLSearchParams {
  return new URLSearchParams(KEPT_KEYS.flatMap((key) => (query.has(key) ? [[key, query.get(key) ?? ""]] : [])));
}

/** Draw the Access screen for the address: the tab the path names, and the review the path or a terminal's code names, over the tokens. */
export function AccessScreen(): ReactNode {
  useChosenTimeZone();
  const navigate = useNavigate();
  const query = useAddressQuery();
  const paths = useMatches({ select: (matches) => matches.map((match) => match.fullPath as string) });
  const tab = paths.includes(PEOPLE_PATH) ? "people" : "tokens";
  const { login } = useParams({ strict: false });
  const asked = askedIn(paths.includes(ALLOW_PAGE), query, login);
  const client = useQueryClient();
  // The login under review is not read again after a change: a read by code is a counted try, and the review closes anyway.
  const actions = useMemo(
    () =>
      accessActions(
        () => void client.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === ACCESS_KEY[0] && queryKey[1] !== "review" }),
        // The side and the Domain screen say that a repair waits once the users changed.
        () => void Promise.all([client.invalidateQueries({ queryKey: FRAME_KEY }), client.invalidateQueries({ queryKey: DOMAIN_KEY })]),
      ),
    [client],
  );
  const review = useReview(asked);
  // A code that names no login tells nothing of the logins that do wait: they are neither read nor drawn from an earlier read.
  const listed = asked?.by !== "code" || review.data !== undefined;
  const waiting = useWaiting(listed && tab === "tokens");
  const sort = tokenSortOf(query);
  const people = usePeople(tab === "people");
  const tokens = useTokens(sort, tab === "tokens");
  const ended = useEndedTokens(sort, tab === "tokens");
  const kept = listQuery(query);
  const opener = useRef<HTMLElement | null>(null);
  // A user, a token, or a waiting login that left its list leaves the focus on nothing: the tab that is open takes it.
  const keptFocus = useFocusHome();
  const openReview = (id: string): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void navigate({ to: "/tokens/review/$login", params: { login: id }, search: searchOf(kept) });
  };

  return (
    <AppShell current="access" heading="Access">
      <div {...keptFocus} className="flex min-h-0 flex-1 flex-col">
        <ScreenTabs label="Who has access" tabs={TABS} active={tab} onChoose={(chosen) => void navigate({ to: TAB_PATHS[chosen] })} />
        {asked !== undefined && review.error !== null ? (
          <div className="px-6 pt-3 max-md:px-4">
            <Alert role="status">
              <AlertDescription>{review.error.message}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {tab === "people" ? (
          <PeopleTab people={people.data} failure={people.error?.message} actions={actions} onRetry={() => void people.refetch()} />
        ) : (
          <TokensTab
            tokens={tokens.data}
            ended={ended.data}
            waiting={listed ? waiting.data : undefined}
            failure={tokens.error?.message}
            waitingFailure={listed ? waiting.error?.message : undefined}
            sort={sort}
            onSort={(next) => void navigate({ to: TOKENS_PATH, search: searchOf(tokenSortQuery(next)) })}
            onReview={(login) => openReview(login.id)}
            actions={actions}
            onRetry={() => void tokens.refetch()}
          />
        )}
      </div>
      <ReviewDialog
        login={asked === undefined ? undefined : review.data}
        actions={actions}
        onClose={() => void navigate({ to: TOKENS_PATH, search: searchOf(kept), replace: true })}
        returnTo={opener}
      />
    </AppShell>
  );
}
