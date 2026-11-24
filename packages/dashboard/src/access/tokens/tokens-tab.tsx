// The Tokens tab of Access: one list of the logins that wait and the tokens that work, with Review at a waiting row, Change expiry and Revoke at a token, and the removed tokens folded away under it. A token's value and a login's code are never here.

import { CopyIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Ended, Token, Waiting, WaitingLogin } from "@/access/access-queries";
import { computerName, SCOPE_WORDS, TOKEN_ORDERS } from "@/access/access-values";
import { ChangeExpiryDialog } from "@/access/tokens/change-expiry-dialog";
import { RemovedTokens } from "@/access/tokens/removed-tokens";
import { RowMenu } from "@/access/row-menu";
import { type TokenRow, tokenRows } from "@/access/tokens/token-rows";
import { Unread } from "@/shared/unread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { expiryOf, shortMoment, wholeMoment } from "@/lib/sites";
import { Confirm, type Question } from "@/shared/confirm";
import type { Fitted } from "@/table/column-widths";
import { type ColumnSpec, DataTable, type Sort } from "@/table/data-table";

/** The width of the last column, wide enough for the worded button a waiting row ends with. */
const ACTION_WIDTH = 104;

/** The orders a phone offers, where no heading can be pressed: the columns the server orders by. */
const ORDERS = [
  { value: "allowed", label: "By approved" },
  { value: "name", label: "By name" },
];

/** The columns of the list. A waiting login has no day it was approved and none it expires. */
const COLUMNS: readonly ColumnSpec<TokenRow>[] = [
  { id: "name", header: "Name", fixed: true, sortable: TOKEN_ORDERS.first.name, cell: (row) => <Name row={row} /> },
  { id: "state", header: "State", cell: (row) => (row.kind === "waiting" ? <WaitingMark login={row.login} /> : <span className="text-muted-foreground">Working</span>) },
  { id: "scope", header: "Can change", cell: (row) => <span className="text-muted-foreground">{SCOPE_WORDS[row.scope]}</span> },
  {
    id: "allowed",
    header: "Approved",
    sortable: TOKEN_ORDERS.first.allowed,
    cell: (row) => (row.kind === "allowed" ? <Allowed token={row.token} /> : null),
  },
  {
    id: "expires",
    header: "Expires",
    cell: (row) => (row.kind === "allowed" ? <span className="text-muted-foreground">{expiryOf(row.token.expires)}</span> : null),
  },
];

/** What the tab is drawn from. */
interface TokensTabProps {
  /** The tokens in the order the address asks for; `undefined` while they are being read. */
  readonly tokens: readonly Token[] | undefined;

  /** The tokens that ended; `undefined` while they are being read. */
  readonly ended?: Ended | undefined;

  /** The newest waiting logins and how many more wait; `undefined` while they are being read, and where they are not to be told of. */
  readonly waiting: Waiting | undefined;

  /** The sentence of a read of the tokens that was refused. */
  readonly failure: string | undefined;

  /** The sentence of a read of the waiting logins that was refused. */
  readonly waitingFailure: string | undefined;

  /** The order the address asks for. */
  readonly sort: Sort;

  /** Asked for another order: the one a press on a heading leads to, or a column's key, which names its first order. */
  readonly onSort: (next: Sort | string | undefined) => void;

  /** Opens the review of one waiting login. */
  readonly onReview: (login: WaitingLogin) => void;

  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** Reads the tokens again. */
  readonly onRetry: () => void;
}

/** The name of a row. A waiting login chose its own, which nobody checked: it stands in quotes, as the words of the login and not of the page, and its review shows it whole. */
function Name({ row }: { readonly row: TokenRow }): ReactNode {
  const name = computerName(row.name);
  if (row.kind === "allowed" || !name.given) {
    return (
      <span className="font-medium" title={name.whole}>
        {name.shown}
      </span>
    );
  }

  return (
    <span className="font-medium">
      "<bdi>{name.shown}</bdi>"
    </span>
  );
}

/** The mark of a login that waits; a pointer shows since when. */
function WaitingMark({ login }: { readonly login: WaitingLogin }): ReactNode {
  return (
    <Badge variant="outline" className="text-muted-foreground" title={`Asked ${wholeMoment(login.asked)}`}>
      Waiting
    </Badge>
  );
}

function Allowed({ token }: { readonly token: Token }): ReactNode {
  return (
    <time dateTime={new Date(token.created).toISOString()} title={wholeMoment(token.created)} className="text-muted-foreground">
      {shortMoment(token.created)}
    </time>
  );
}

/**
 * The command that logs a computer in at this dashboard, with the way to copy it: a button with its word, since the box opens with the focus on it and a hint shown there would lie over the words above.
 *
 * The address is the one this page was answered from. The space between its two parts is text, so a selection copies the command whole.
 */
function LoginCommand({ onCopy }: { readonly onCopy: AccessActions["copyCommand"] }): ReactNode {
  const [run, server] = ["npx poplin login", `--server ${window.location.origin}`];
  const command = `${run} ${server}`;

  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="flex min-w-0 flex-1 flex-wrap rounded-md border bg-muted/40 px-2.5 py-1.5 text-left font-mono text-xs" title={command}>
        <span className="whitespace-pre">{run} </span>
        <span className="min-w-0 wrap-anywhere">{server}</span>
      </code>
      <Button variant="ghost" size="sm" aria-label="Copy the command" className="shrink-0 pointer-coarse:min-h-10" onClick={() => void onCopy(command)}>
        <CopyIcon data-icon="inline-start" />
        Copy
      </Button>
    </span>
  );
}

/** How a token is made: said behind a button, since the computer that gets it starts the login. */
function AddToken({ onCopy }: { readonly onCopy: AccessActions["copyCommand"] }): ReactNode {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="max-md:min-h-10" />}>
        <PlusIcon data-icon="inline-start" />
        Add a token
      </PopoverTrigger>
      <PopoverContent align="end" className="w-88 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Add a token</PopoverTitle>
          <PopoverDescription>Run this on the machine or agent:</PopoverDescription>
        </PopoverHeader>
        <LoginCommand onCopy={onCopy} />
        <p className="text-[13px] text-muted-foreground">It then waits here: press Review to approve it.</p>
      </PopoverContent>
    </Popover>
  );
}

/** The order of the list on a phone, where no heading can be pressed. */
function OrderSelect({ sort, onSort }: Pick<TokensTabProps, "sort" | "onSort">): ReactNode {
  return (
    <Select items={ORDERS} value={sort.key} onValueChange={(value) => onSort(String(value))}>
      <SelectTrigger aria-label="Order" className="w-32 md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        <SelectGroup>
          {ORDERS.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** What a phone says under a row's name, in the words of the table's headings: what the row can change, and for a token since when, and until when. */
function PhoneFacts({ row }: { readonly row: TokenRow }): ReactNode {
  const scope = <span className="truncate text-[13px] text-muted-foreground">Can change: {SCOPE_WORDS[row.scope]}</span>;
  if (row.kind === "waiting") return scope;

  const { token } = row;

  return (
    <>
      {scope}
      <span className="truncate text-[13px] text-muted-foreground">
        Approved <Allowed token={token} />, {token.expires === "never" ? "never expires" : `expires ${expiryOf(token.expires)}`}
      </span>
    </>
  );
}

/**
 * What follows the last row: why a part of the list is not there, and how many more logins wait than are listed.
 *
 * @param unread - the sentence of a read that was refused while the other part of the list was read
 */
function afterRows(more: number, unread: string | undefined): ReactNode {
  if (unread === undefined && more === 0) return undefined;

  return (
    <div className="flex flex-col gap-1 px-6 py-2 text-[13px] text-muted-foreground max-md:px-4">
      {unread === undefined ? null : <p>{unread}</p>}
      {more === 0 ? null : <p>{more === 1 ? "1 more is waiting." : `${more} more are waiting.`}</p>}
    </div>
  );
}

/** The name of each token that has one, by its id: what a token revoked by another token is said to be revoked by. */
function namesOf(tokens: readonly Token[], ended: Ended | undefined): Record<string, string> {
  const named = [...tokens, ...(ended?.tokens ?? [])].filter((token) => token.note.trim() !== "");

  return Object.fromEntries(named.map((token) => [token.id, token.note]));
}

/** The question before a token is revoked. */
function leavingQuestion(token: Token | undefined): Question | undefined {
  if (token === undefined) return undefined;

  return { title: `Revoke ${computerName(token.note).shown}?`, says: "Its token stops working at once.", yes: "Revoke", removes: true };
}

/** Draw the Tokens tab. */
export function TokensTab({ tokens, ended, waiting, failure, waitingFailure, sort, onSort, onReview, actions, onRetry }: TokensTabProps): ReactNode {
  const [leaving, setLeaving] = useState<Token>();
  const [changing, setChanging] = useState<Token>();
  // The removed tokens under the list are told what the list measured, so no column of theirs is narrower than the list's. The list is told nothing: opening them moves none of its columns.
  const [fitted, setFitted] = useState<Fitted>();
  const rows = useMemo(() => tokenRows(waiting?.logins ?? [], tokens ?? []), [waiting, tokens]);
  // A read of the tokens that was refused does not hide the logins that wait: they are listed, and the refusal is said under them.
  const unreadTokens = tokens === undefined ? failure : undefined;
  const after = afterRows(waiting?.more ?? 0, unreadTokens ?? waitingFailure);
  const names = useMemo(() => namesOf(tokens ?? [], ended), [tokens, ended]);
  const none = ended === undefined || ended.tokens.length === 0;
  const removed = none ? undefined : <RemovedTokens ended={ended} names={names} />;
  // Under the table the removed tokens are a second table that starts in the list's columns; under a phone's list, and where no list is, they stand alone.
  const paired = none ? undefined : <RemovedTokens ended={ended} names={names} alongside={fitted} />;
  const afterAll = (under: ReactNode): ReactNode =>
    after === undefined && under === undefined ? undefined : (
      <>
        {after}
        {under}
      </>
    );

  const actionOf = (row: TokenRow): ReactNode => {
    // A waiting login chose its own name, which nobody checked: the button that opens it is named by the page alone.
    if (row.kind === "waiting") {
      return (
        <Button variant="outline" size="sm" onClick={() => onReview(row.login)}>
          Review
        </Button>
      );
    }

    return <RowMenu name={computerName(row.name).shown} word="Revoke" onRemove={() => setLeaving(row.token)} also={{ word: "Change expiry", onChoose: () => setChanging(row.token) }} />;
  };
  const answer = (yes: boolean): void => {
    if (yes && leaving !== undefined) void actions.removeToken(leaving);

    setLeaving(undefined);
  };
  const list = (): ReactNode => {
    if (unreadTokens !== undefined && rows.length === 0) return <Unread title="The tokens could not be read" failure={unreadTokens} onRetry={onRetry} />;

    if (tokens !== undefined && rows.length === 0) {
      return (
        <div>
          <Empty className="flex-none py-16">
            <EmptyHeader>
              <EmptyTitle>{removed === undefined ? "No tokens yet" : "No tokens"}</EmptyTitle>
              <EmptyDescription>Run this on a machine or agent:</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="max-w-full">
              <LoginCommand onCopy={actions.copyCommand} />
              {after}
            </EmptyContent>
          </Empty>
          {removed}
        </div>
      );
    }

    return (
      <>
        <div className="shrink-0 max-md:hidden">
          <DataTable
            label="Tokens"
            columns={COLUMNS}
            rows={rows}
            rowId={(row) => row.key}
            sort={sort}
            onSort={onSort}
            actions={actionOf}
            actionsWidth={ACTION_WIDTH}
            loading={tokens === undefined && rows.length === 0}
            after={afterAll(paired)}
            onFitted={setFitted}
          />
        </div>
        <div className="md:hidden">
          <ul aria-label="Tokens" className="border-t">
            {rows.map((row) => (
              <li key={row.key} className="group/row flex min-h-16 items-center gap-2 border-b px-4 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">
                      <Name row={row} />
                    </span>
                    {row.kind === "waiting" ? <WaitingMark login={row.login} /> : <span className="shrink-0 text-[13px] text-muted-foreground">Working</span>}
                  </span>
                  <PhoneFacts row={row} />
                </div>
                {actionOf(row)}
              </li>
            ))}
          </ul>
          {afterAll(removed)}
        </div>
      </>
    );
  };

  return (
    <section aria-label="Tokens" className="flex min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 py-3 max-md:px-4">
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground max-md:basis-full max-md:whitespace-normal">
          A token lets a machine or an agent publish.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {tokens === undefined || tokens.length < 2 ? null : <OrderSelect sort={sort} onSort={onSort} />}
          <AddToken onCopy={actions.copyCommand} />
        </div>
      </div>
      {list()}
      <Confirm question={leavingQuestion(leaving)} onAnswer={answer} />
      <ChangeExpiryDialog token={changing} actions={actions} onClose={() => setChanging(undefined)} />
    </section>
  );
}
