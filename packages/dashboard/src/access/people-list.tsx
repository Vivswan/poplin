// The people who can log in: one row each, the way to take one out, and the field that adds one. The person who is logged in here has no Remove.

import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import { usePeople } from "@/access/access-queries";
import { AccessSection, InsteadOfRows } from "@/access/access-section";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Confirm } from "@/shared/confirm";
import { type ColumnSpec, DataTable } from "@/table/data-table";
import { useTableLayout } from "@/table/layout";

/** The longest email the field takes, in characters. */
const LONGEST_EMAIL = 254;

/** The order of the list: as the settings hold it, which no heading changes. */
const AS_LISTED = { key: "", descending: false } as const;

/** The width of the last column, whose rows end with a worded button. */
const REMOVE_WIDTH = 104;

/** The look of a row's Remove: quiet at rest, as the row actions of the Sites table are, and whole when the row is pointed at or holds the focus, and on a narrow or a touch screen. */
const ON_POINTING = "opacity-60 group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100";

/** One person of the list. */
interface Person {
  /** The email the person logs in with. */
  readonly email: string;

  /** Whether this is the person logged in here. */
  readonly you: boolean;
}

/** The field that adds a person. A refusal is said on the line kept under it, so it moves nothing, and the typed email stays. */
function AddPerson({ onAdd }: { readonly onAdd: AccessActions["addPerson"] }): ReactNode {
  const [email, setEmail] = useState("");
  const [refusal, setRefusal] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refusalId = useId();

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const refused = await onAdd(email.trim());
    setBusy(false);
    setRefusal(refused);
    if (refused === undefined) setEmail("");
  };

  return (
    <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 pt-3 max-md:px-4">
      <Field data-invalid={refusal !== undefined} className="w-80 flex-none max-md:w-auto max-md:flex-1">
        <Input
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setRefusal(undefined);
          }}
          aria-label="Email of the person to add"
          aria-invalid={refusal !== undefined}
          aria-describedby={refusal === undefined ? undefined : refusalId}
          placeholder="name@example.com"
          inputMode="email"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          maxLength={LONGEST_EMAIL}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={busy || email.trim() === ""}>
        Add a person
      </Button>
      <div className="min-h-5 basis-full max-md:min-h-10">
        {refusal === undefined ? null : (
          <FieldError id={refusalId} className="text-[13px]">
            {refusal}
          </FieldError>
        )}
      </div>
    </form>
  );
}

/** Draw the people who can log in. */
export function PeopleList({ actions }: { readonly actions: AccessActions }): ReactNode {
  const { data, error } = usePeople();
  const [leaving, setLeaving] = useState<Person>();
  const people = useMemo<readonly Person[]>(() => (data?.logins ?? []).map((email) => ({ email, you: email === data?.you })), [data]);
  const columns = useMemo<readonly ColumnSpec<Person>[]>(
    () => [{ id: "email", header: "Email", size: 320, fixed: true, grows: true, cell: (person) => <span title={person.email}>{person.email}</span> }],
    [],
  );
  const layout = useTableLayout("people", columns);

  const removeOf = (person: Person): ReactNode => {
    if (person.you) return <span className="pr-2.5 text-[13px] text-muted-foreground">you</span>;

    return (
      <Button variant="ghost" size="sm" aria-label={`Remove ${person.email}`} className={ON_POINTING} onClick={() => setLeaving(person)}>
        Remove
      </Button>
    );
  };
  const answer = (yes: boolean): void => {
    if (yes && leaving !== undefined) void actions.removePerson(leaving.email);

    setLeaving(undefined);
  };

  return (
    <AccessSection title="People" count={data?.logins.length} says="can log in here and change everything">
      {data === undefined ? (
        <InsteadOfRows failure={error?.message} />
      ) : (
        <>
          <div className="max-md:hidden">
            <DataTable
              label="People"
              columns={columns}
              rows={people}
              rowId={(person) => person.email}
              layout={layout}
              sort={AS_LISTED}
              actions={removeOf}
              actionsWidth={REMOVE_WIDTH}
            />
          </div>
          <ul aria-label="People" className="border-t md:hidden">
            {people.map((person) => (
              <li key={person.email} className="group/row flex h-11 items-center gap-2 border-b px-4">
                <span className="min-w-0 flex-1 truncate" title={person.email}>
                  {person.email}
                </span>
                {removeOf(person)}
              </li>
            ))}
          </ul>
          <AddPerson onAdd={actions.addPerson} />
        </>
      )}
      <Confirm
        question={
          leaving === undefined
            ? undefined
            : { title: `Remove ${leaving.email}?`, says: "This person can no longer log in.", yes: "Remove", no: "Keep", removes: true }
        }
        onAnswer={answer}
      />
    </AccessSection>
  );
}
