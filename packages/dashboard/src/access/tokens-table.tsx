// The computers and agents that publish with a token: one row each with what it may change, when it was allowed, and when it runs out; the way to remove one; and the command that logs a computer in. A token's value is never here.

import { cn } from "cn";
import { CopyIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import { type Token, useTokens } from "@/access/access-queries";
import { AccessSection, InsteadOfRows } from "@/access/access-section";
import { computerName, SCOPE_WORDS, TOKEN_ORDERS } from "@/access/access-values";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { expiryOf, shortMoment, wholeMoment } from "@/lib/sites";
import { Confirm } from "@/shared/confirm";
import { IconButton } from "@/shared/icon-button";
import { type ColumnSpec, ColumnsMenu, DataTable, type Sort } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The look of a row's Remove: quiet at rest, as the row actions of the Sites table are, and whole when the row is pointed at or holds the focus, and on a narrow or a touch screen. */
const ON_POINTING = "opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100";

/** The width of the last column, whose rows end with a worded button. */
const REMOVE_WIDTH = 104;

/** The orders a phone offers, where no heading can be pressed: the columns the server orders by. */
const ORDERS = [
  { value: "allowed", label: "By allowed" },
  { value: "name", label: "By name" },
];

/** What the table is drawn from. */
interface TokensTableProps {
  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** The order the address asks for. */
  readonly sort: Sort;

  /** Asked for another order: the one a press on a heading leads to, or a column's key, which names its first order. */
  readonly onSort: (next: Sort | string | undefined) => void;
}

function TokenName({ token }: { readonly token: Token }): ReactNode {
  const name = computerName(token.note);

  return (
    <span className="font-medium" title={name.whole}>
      {name.shown}
    </span>
  );
}

function Allowed({ token }: { readonly token: Token }): ReactNode {
  return (
    <time dateTime={new Date(token.created).toISOString()} title={wholeMoment(token.created)} className="text-muted-foreground">
      {shortMoment(token.created)}
    </time>
  );
}

/** The columns of the tokens. */
const COLUMNS: readonly ColumnSpec<Token>[] = [
  { id: "name", header: "Name", fixed: true, sortable: TOKEN_ORDERS.first.name, cell: (token) => <TokenName token={token} /> },
  { id: "scope", header: "Can change", cell: (token) => <span className="text-muted-foreground">{SCOPE_WORDS[token.scope]}</span> },
  { id: "allowed", header: "Allowed", sortable: TOKEN_ORDERS.first.allowed, cell: (token) => <Allowed token={token} /> },
  { id: "expires", header: "Runs out", cell: (token) => <span className="text-muted-foreground">{expiryOf(token.expires)}</span> },
];

/**
 * The command that logs a computer in at this dashboard, with the way to copy it. On a phone the command stands under its words and wraps, so the whole address can be read.
 *
 * @param className - classes laid over the line's own
 */
function LoginCommand({ onCopy, className }: { readonly onCopy: AccessActions["copyCommand"]; readonly className?: string }): ReactNode {
  const command = `npx poplin login --server ${window.location.origin}`;

  return (
    <p className={cn("flex min-h-11 items-center gap-x-2 text-[13px] text-muted-foreground max-md:flex-wrap max-md:py-2", className)}>
      <span className="shrink-0 max-md:w-full">Log a computer in:</span>
      <code
        className="min-w-0 truncate font-mono text-xs text-foreground max-md:flex-1 max-md:text-wrap max-md:wrap-anywhere max-md:whitespace-normal"
        title={command}
      >
        {command}
      </code>
      <IconButton label="Copy the command" onClick={() => void onCopy(command)}>
        <CopyIcon />
      </IconButton>
    </p>
  );
}

/** The order of the list on a phone, where no heading can be pressed. */
function OrderSelect({ sort, onSort }: Pick<TokensTableProps, "sort" | "onSort">): ReactNode {
  return (
    <Select items={ORDERS} value={sort.key} onValueChange={(value) => onSort(String(value))}>
      <SelectTrigger aria-label="Order" size="sm" className="w-32 md:hidden">
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

/** Draw the tokens of computers and agents. */
export function TokensTable({ actions, sort, onSort }: TokensTableProps): ReactNode {
  const { data: tokens, error } = useTokens(sort);
  const [leaving, setLeaving] = useState<Token>();
  const layout = useTableLayout("tokens", COLUMNS);
  const question = useMemo(
    () =>
      leaving === undefined
        ? undefined
        : { title: `Remove ${computerName(leaving.note).shown}?`, says: "Its token stops working at once.", yes: "Remove", no: "Keep", removes: true },
    [leaving],
  );
  const some = tokens !== undefined && tokens.length > 0;

  const removeOf = (token: Token): ReactNode => (
    <Button variant="ghost" size="sm" aria-label={`Remove ${computerName(token.note).shown}`} className={ON_POINTING} onClick={() => setLeaving(token)}>
      Remove
    </Button>
  );
  const answer = (yes: boolean): void => {
    if (yes && leaving !== undefined) void actions.removeToken(leaving);

    setLeaving(undefined);
  };
  const rows = (listed: readonly Token[]): ReactNode => {
    if (listed.length === 0) {
      return (
        <Empty className="flex-none rounded-none border-0 border-t border-solid py-10">
          <EmptyHeader>
            <EmptyTitle>No computer or agent is logged in.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent className="max-w-full">
            <LoginCommand onCopy={actions.copyCommand} className="max-md:justify-center max-md:text-center" />
          </EmptyContent>
        </Empty>
      );
    }

    return (
      <>
        <div className="max-md:hidden">
          <DataTable
            label="Computers and agents"
            columns={COLUMNS}
            rows={listed}
            rowId={(token) => token.id}
            layout={layout}
            sort={sort}
            onSort={onSort}
            actions={removeOf}
            actionsWidth={REMOVE_WIDTH}
          />
        </div>
        <ul aria-label="Computers and agents" className="border-t md:hidden">
          {listed.map((token) => (
            <li key={token.id} className="group/row flex min-h-16 items-center gap-2 border-b px-4 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">
                  <TokenName token={token} />
                </span>
                <span className="truncate text-[13px] text-muted-foreground">{SCOPE_WORDS[token.scope]}</span>
                <span className="truncate text-[13px] text-muted-foreground">
                  Allowed <Allowed token={token} />, {token.expires === "never" ? "never runs out" : `runs out ${expiryOf(token.expires)}`}
                </span>
              </div>
              {removeOf(token)}
            </li>
          ))}
        </ul>
        <LoginCommand onCopy={actions.copyCommand} className="px-6 max-md:px-4" />
      </>
    );
  };

  return (
    <AccessSection
      title="Computers and agents"
      count={tokens?.length}
      says="publish with a token"
      tools={
        some ? (
          <>
            <OrderSelect sort={sort} onSort={onSort} />
            <div className="max-md:hidden">
              <ColumnsMenu columns={COLUMNS} layout={layout} />
            </div>
          </>
        ) : undefined
      }
    >
      {tokens === undefined ? <InsteadOfRows failure={error?.message} /> : rows(tokens)}
      <Confirm question={question} onAnswer={answer} />
    </AccessSection>
  );
}
