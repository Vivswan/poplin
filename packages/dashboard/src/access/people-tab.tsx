// The Users tab of Access: the people who can log in, one row each, the way to add one and to take one out, and the sign-out of every browser. The person who is logged in here has no Remove.

import { LogOutIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { People } from "@/access/access-queries";
import { RowMenu } from "@/access/row-menu";
import { Unread } from "@/shared/unread";
import { Button } from "@/components/ui/button";
import { AskDialog } from "@/shared/ask-dialog";
import { Confirm, type Question } from "@/shared/confirm";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The longest email the field takes, in characters. */
const LONGEST_EMAIL = 254;

/** The order of the list: as the settings hold it, which no heading changes. */
const AS_LISTED = { key: "", descending: false } as const;

/** The one column of the list. */
const COLUMNS: readonly ColumnSpec<Person>[] = [
  { id: "email", header: "Email", fixed: true, cell: (person) => <span title={person.email}>{person.email}</span> },
];

/** The question before every session is ended. */
const SIGN_OUT: Question = {
  title: "Sign everyone out?",
  says: "Every browser has to log in again, this one too.",
  yes: "Sign everyone out",
  removes: true,
};

/** One person of the list. */
interface Person {
  /** The email the person logs in with. */
  readonly email: string;

  /** Whether this is the person logged in here. */
  readonly you: boolean;
}

/** What the tab is drawn from. */
interface PeopleTabProps {
  /** The people who can log in and which one is logged in here; `undefined` while they are being read. */
  readonly people: People | undefined;

  /** The sentence of a read that was refused. */
  readonly failure: string | undefined;

  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** Reads the people again. */
  readonly onRetry: () => void;
}

/** The question before a person is taken out. */
function leavingQuestion(person: Person | undefined): Question | undefined {
  if (person === undefined) return undefined;

  return { title: `Remove ${person.email}?`, says: "This user can no longer log in.", yes: "Remove", no: "Keep", removes: true };
}

/** Draw the Users tab. */
export function PeopleTab({ people, failure, actions, onRetry }: PeopleTabProps): ReactNode {
  // Each opening of the dialog has its own number: an add that answers after its dialog was left closes nothing that was opened since.
  const [adding, setAdding] = useState<number>();
  const openings = useRef(0);
  const [leaving, setLeaving] = useState<Person>();
  const [signingOut, setSigningOut] = useState(false);
  const rows = useMemo<readonly Person[]>(() => (people?.logins ?? []).map((email) => ({ email, you: email === people?.you })), [people]);
  const layout = useTableLayout("people", COLUMNS);

  const removeOf = (person: Person): ReactNode => {
    if (person.you) return <span className="inline-flex h-7 min-w-7 items-center justify-center text-[13px] text-muted-foreground">you</span>;

    return <RowMenu name={person.email} onRemove={() => setLeaving(person)} />;
  };
  const openAdding = (): void => {
    openings.current += 1;
    setAdding(openings.current);
  };
  const answerLeaving = (yes: boolean): void => {
    if (yes && leaving !== undefined) void actions.removePerson(leaving.email);

    setLeaving(undefined);
  };
  const answerSignOut = (yes: boolean): void => {
    setSigningOut(false);
    if (yes) void actions.signEveryoneOut();
  };

  return (
    <section aria-label="Users" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 py-3 max-md:px-4">
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground max-md:basis-full max-md:whitespace-normal">
          Users can log in here and change everything.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => setSigningOut(true)}>
            <LogOutIcon data-icon="inline-start" />
            Sign everyone out
          </Button>
          <Button variant="outline" onClick={openAdding}>
            <PlusIcon data-icon="inline-start" />
            Add a user
          </Button>
        </div>
      </div>
      {failure !== undefined && people === undefined ? (
        <Unread title="The users could not be read" failure={failure} onRetry={onRetry} />
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col max-md:hidden">
            <DataTable
              label="Users"
              columns={COLUMNS}
              rows={rows}
              rowId={(person) => person.email}
              layout={layout}
              sort={AS_LISTED}
              actions={removeOf}
              loading={people === undefined}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
            <ul aria-label="Users" className="border-t">
              {rows.map((person) => (
                <li key={person.email} className="group/row flex h-11 items-center gap-2 border-b px-4">
                  <span className="min-w-0 flex-1 truncate" title={person.email}>
                    {person.email}
                  </span>
                  {removeOf(person)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <AskDialog
        key={adding}
        open={adding !== undefined}
        onOpenChange={(open) => setAdding((now) => (open || now !== adding ? now : undefined))}
        title="Add a user"
        says="This user can log in here and change everything."
        label="Email"
        hint="Such as name@example.com."
        initial=""
        maxLength={LONGEST_EMAIL}
        submit="Add a user"
        onSubmit={actions.addPerson}
      />
      <Confirm question={leavingQuestion(leaving)} onAnswer={answerLeaving} />
      <Confirm question={signingOut ? SIGN_OUT : undefined} onAnswer={answerSignOut} />
    </section>
  );
}
