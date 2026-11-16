// The removed tokens of the Tokens tab: the tokens that work no more, folded away under the list until a person opens them. Each says when it ended and how; none can be used again, and none has an action.
// Their table stands in the columns of the list above it, one for one, so the edges of the two line up.

import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import useLocalStorageState from "use-local-storage-state";

import type { Ended, EndedToken } from "@/access/access-queries";
import { computerName, SCOPE_WORDS } from "@/access/access-values";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { type LoginNames, Who } from "@/shared/who";
import type { Fitted } from "@/table/column-widths";
import { type ColumnSpec, DataTable } from "@/table/data-table";

/** The key the browser keeps under whether the removed tokens are open. */
const OPEN_KEY = "poplin.tokens.removed";

/** The order of the list, which no heading changes: the token that ended last comes first. */
const ORDER = { key: "ended", descending: true };

/** The columns of the list, under the ids of the list above it: how a token ended stands where a token's state does, and the day it ended where a token runs out. */
const COLUMNS: readonly ColumnSpec<Row>[] = [
  { id: "name", header: "Name", fixed: true, cell: ({ token }) => <Name token={token} /> },
  { id: "state", header: "How", cell: (row) => <How {...row} /> },
  { id: "scope", header: "Could change", cell: ({ token }) => SCOPE_WORDS[token.scope] },
  { id: "allowed", header: "Allowed", cell: ({ token }) => <Moment at={token.created} /> },
  { id: "expires", header: "Ended", cell: ({ token }) => <Moment at={token.ended} /> },
];

/** What a removed token ends its row with under the list above: nothing, in the room the list's own rows end with their actions in. */
const NO_ACTION = (): ReactNode => null;

/** One row of the list: a token that ended, and the names its remover is written with. */
interface Row {
  readonly token: EndedToken;
  readonly names: LoginNames;
}

/** What the removed tokens are drawn from. */
interface RemovedTokensProps {
  /** The tokens that ended, the one that ended last first, and whether there are more. */
  readonly ended: Ended;

  /** The name of each token that has one, by its id: a token removed by another is said to be removed by that name. */
  readonly names: LoginNames;

  /** What the list above measured of its columns; left out where no list is above. */
  readonly alongside?: Fitted;

  /** The width the rows of the list above end with their actions in, in pixels: the same room is left empty here, so both tables have the same room for their columns. Left out where no list is above. */
  readonly endWidth?: number;

  /** Told what this list measured of its columns, for the list above. */
  readonly onFitted?: (fitted: Fitted | undefined) => void;
}

/** Say how a token ended: that it ran out, that it gave itself back, or who removed it, written as on every screen. */
function How({ token, names }: Row): ReactNode {
  if (token.how === "ran_out") return "Ran out";

  if (token.by === token.id) return "Logged out";

  return (
    <>
      Removed by <Who by={token.by} logins={names} unnamed="a token" />
    </>
  );
}

function Name({ token }: { readonly token: EndedToken }): ReactNode {
  const name = computerName(token.note);

  return <span title={name.whole}>{name.shown}</span>;
}

function Moment({ at }: { readonly at: number }): ReactNode {
  return (
    <time dateTime={new Date(at).toISOString()} title={wholeMoment(at)} className="tabular-nums">
      {shortMoment(at)}
    </time>
  );
}

/** When a token ended, then how, in one line of a phone's list: the words are cut where the line is narrow. */
function End({ row }: { readonly row: Row }): ReactNode {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-24 shrink-0">
        <Moment at={row.token.ended} />
      </span>
      <span className="truncate text-faint">
        <How {...row} />
      </span>
    </span>
  );
}

/** Draw the removed tokens under the list of the ones that work: closed until a person opens them, which the browser keeps. Nothing at all is drawn where no token ended. */
export function RemovedTokens({ ended, names, alongside, endWidth, onFitted }: RemovedTokensProps): ReactNode {
  const [kept, keep] = useLocalStorageState<unknown>(OPEN_KEY);
  if (ended.tokens.length === 0) return null;

  const rows = ended.tokens.map((token) => ({ token, names }));

  return (
    <Collapsible open={kept === true} onOpenChange={(open) => keep(open)} className="text-muted-foreground">
      <div className="px-4 py-1.5 max-md:px-2">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/removed gap-1.5 text-muted-foreground max-md:min-h-10" />}>
          <ChevronRightIcon className="transition-transform group-data-[panel-open]/removed:rotate-90" />
          Removed tokens
          <span className="font-normal text-faint tabular-nums">
            {rows.length}
            {ended.more ? "+" : ""}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="max-md:hidden">
          <DataTable
            label="Removed tokens"
            columns={COLUMNS}
            rows={rows}
            rowId={({ token }) => token.id}
            sort={ORDER}
            alongside={alongside}
            onFitted={onFitted}
            actions={endWidth === undefined ? undefined : NO_ACTION}
            actionsWidth={endWidth}
          />
        </div>
        <ul aria-label="Removed tokens" className="border-t md:hidden">
          {rows.map((row) => (
            <li key={row.token.id} className="flex min-h-16 flex-col justify-center gap-0.5 border-b px-4 py-2">
              <span className="truncate">
                <Name token={row.token} />
              </span>
              <span className="truncate text-[13px]">Could change: {SCOPE_WORDS[row.token.scope]}</span>
              <span className="text-[13px]">
                <End row={row} />
              </span>
            </li>
          ))}
        </ul>
        {ended.more ? <p className="px-6 py-2 text-[13px] max-md:px-4">Showing the newest {rows.length}.</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
