// One group of the Settings screen: its heading, which folds it, its rows, and the one Save that sends what was typed in it. A switch or a choice is saved the moment it is changed. A refusal shows at its field with everything typed kept.

import { MutationObserver, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldError } from "@/components/ui/field";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { RowFrame } from "@/settings/row-frame";
import { SettingControl } from "@/settings/setting-control";
import { readOf, sentOf, shownOf } from "@/settings/setting-values";
import { type Row, SETTINGS_KEY, type Settings } from "@/settings/settings-queries";
import { type Group, wordsOf } from "@/settings/settings-words";

/** What a save says once the logins changed: the login page learns of them only by a repair. */
const SAVED_LOGINS =
  "Saved. One more step: open the Domain tab, paste a token, and press Repair. Until then the login page lets in only the emails it had before.";

/** What is shown when a save fails for a reason that is no refusal. */
const FAULT = "That did not work. Try again.";

/** What every save of a setting shares: they are sent one after another, in the order they were made, so the last value is the one stored. */
const IN_ORDER = { id: "settings-saves" } as const;

/** The key the saves are counted under, so the last one of a run of them is known. */
const SAVES_KEY = [...SETTINGS_KEY, "save"] as const;

/** The texts of some settings, by key. */
type Texts = Readonly<Record<string, string>>;

/** A refusal of a save: the setting it is about, and the sentence. */
interface Refusal {
  readonly key: string;
  readonly sentence: string;
}

/** What a group is drawn from. */
interface SettingGroupProps {
  /** The group's heading and rows. */
  readonly group: Group;

  /** A line under the heading, for a group that needs one. */
  readonly says?: ReactNode;

  /** Told, under the group's id, whether the group holds typing its Save has not sent. */
  readonly onUnsaved: (id: string, unsaved: boolean) => void;

  /** Rows of the group that are no setting, drawn after its settings. */
  readonly children?: ReactNode;
}

function controlId(key: string): string {
  return `setting-${key}`;
}

/** Send a save of some settings. */
function sendSave(texts: Texts): Promise<{ readonly loginsChanged: boolean }> {
  return answerOf(api.settings.$post({ json: { texts } }));
}

/** Show some settings as stored with new texts, before the rows are read again. A read already on its way is dropped: it holds the texts from before. */
function showStored(client: QueryClient, texts: Texts): void {
  void client.cancelQueries({ queryKey: SETTINGS_KEY });
  client.setQueryData<Settings>(SETTINGS_KEY, (kept) =>
    kept === undefined ? kept : { ...kept, rows: kept.rows.map((row) => (Object.hasOwn(texts, row.key) ? { ...row, text: texts[row.key] ?? row.text } : row)) },
  );
}

/** Read the rows again once the last save of a run of them has its answer: a read made earlier would undo, on the screen, a change that is still on its way. */
function readAfterLast(client: QueryClient): Promise<void> | undefined {
  return client.isMutating({ mutationKey: SAVES_KEY }) === 1 ? client.invalidateQueries({ queryKey: SETTINGS_KEY }) : undefined;
}

/** Take a done save back: store the texts from before it, in its turn among the saves, and say so. A refusal is said as a line. The line's Undo may be pressed after its group is gone, so the save is the page's and no group's. */
function putBack(client: QueryClient, texts: Texts): void {
  const undo = new MutationObserver(client, {
    scope: IN_ORDER,
    mutationKey: SAVES_KEY,
    mutationFn: sendSave,
    onSuccess: () => sayDone("Put back."),
    onError: (error) => sayRefused(error instanceof Refused ? error.message : FAULT),
    onSettled: () => readAfterLast(client),
  });
  // The texts show at the press, as a switch does, so a change made after it is shown over them and not under.
  showStored(client, texts);
  void undo
    .mutate(texts)
    .catch(() => undefined)
    .finally(() => undo.reset());
}

/** Whether a setting is saved the moment its control is changed: one that is switched or chosen. A typed one waits for its group's Save. */
function savesAtOnce(row: Row): boolean {
  return row.control.kind === "switch" || row.control.kind === "choice";
}

/** The state at a row's end: the host's warning for a value above its free limit, and that the value is not the default. */
function StateCell({ row }: { readonly row: Row }): ReactNode {
  return (
    <span className="flex flex-col gap-1">
      {row.changed ? <span className="text-muted-foreground">Changed</span> : null}
      {row.warning === null ? null : (
        <span className="flex gap-1.5 text-warn">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>Warning: {row.warning}</span>
        </span>
      )}
    </span>
  );
}

function SettingRow({
  row,
  shown,
  refusal,
  onChange,
}: {
  readonly row: Row;
  readonly shown: string;
  readonly refusal: string | undefined;
  readonly onChange: (shown: string) => void;
}): ReactNode {
  const words = wordsOf(row.key);
  const id = controlId(row.key);

  return (
    <RowFrame label={words.label} controlId={id} meaning={words.meaning} rawKey={row.key} fallback={readOf(row, row.fallback)} state={<StateCell row={row} />}>
      {row.elsewhere ? (
        <span id={id} className="flex h-8 items-center text-muted-foreground">
          {readOf(row, row.text)}
        </span>
      ) : (
        <SettingControl row={row} id={id} shown={shown} onChange={onChange} refused={refusal !== undefined} />
      )}
      {refusal === undefined ? null : <FieldError className="text-[13px]">{refusal}</FieldError>}
    </RowFrame>
  );
}

/**
 * The bar a group opens with: its heading, which folds it, the count of its settings while it is shut, and its Save.
 *
 * @param save - whether something typed waits to be sent, and whether a save is on its way; left out for a group with nothing typed in it, which has no Save
 */
function GroupHead({
  id,
  group,
  open,
  save,
}: {
  readonly id: string;
  readonly group: Group;
  readonly open: boolean;
  readonly save: { readonly ready: boolean; readonly busy: boolean } | undefined;
}): ReactNode {
  return (
    <div className="flex h-11 items-center gap-3 border-b bg-muted/50 px-6 max-md:px-4">
      <CollapsibleTrigger className="group/fold -ml-1.5 flex h-8 items-center gap-1.5 rounded-md px-1.5 font-bold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-aria-expanded/fold:rotate-90" />
        <span id={id}>{group.label}</span>
      </CollapsibleTrigger>
      {open ? null : <span className="text-xs text-muted-foreground">{group.rows.length === 1 ? "1 setting" : `${group.rows.length} settings`}</span>}
      {save !== undefined && open ? (
        <Button type="submit" size="sm" variant={save.ready ? "default" : "outline"} className="ml-auto" disabled={!save.ready || save.busy}>
          Save
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The saves of one group, each sent after the one before it.
 *
 * @param refuse - shows a save's refusal
 * @param onStored - called with the texts a Save stored, once they show as stored
 * @returns `saving`, the group's Save of what was typed, and `saveNow`, which shows a switch's or a choice's new value at once and sends it
 */
function useSaves(refuse: (error: Error) => void, onStored: (texts: Texts) => void) {
  const client = useQueryClient();
  const undoOf = (before: Texts): { readonly run: () => void } => ({ run: () => putBack(client, before) });

  const saving = useMutation({
    scope: IN_ORDER,
    mutationKey: SAVES_KEY,
    mutationFn: (save: { readonly texts: Texts; readonly before: Texts }) => sendSave(save.texts),
    onError: refuse,
    // The stored texts show before the save stops counting as on its way, so no field is compared with a value from before it.
    onSuccess: (done, save) => {
      showStored(client, save.texts);
      onStored(save.texts);
      sayDone(done.loginsChanged ? SAVED_LOGINS : "Saved.", undoOf(save.before));
    },
    onSettled: () => readAfterLast(client),
  });
  const switching = useMutation({
    scope: IN_ORDER,
    mutationKey: SAVES_KEY,
    mutationFn: sendSave,
    onError: refuse,
    onSettled: () => readAfterLast(client),
  });

  const saveNow = (row: Row, value: string): void => {
    const sent = sentOf(row, value);
    // Read where the screen's data is kept, so an Undo pressed later takes back from what is shown then.
    const before = client.getQueryData<Settings>(SETTINGS_KEY)?.rows.find((entry) => entry.key === row.key)?.text ?? row.text;
    showStored(client, { [row.key]: sent });
    switching.mutate({ [row.key]: sent }, { onSuccess: () => sayDone("Saved.", undoOf({ [row.key]: before })) });
  };

  return { saving, saveNow };
}

/**
 * Draw one group.
 *
 * A typed value waits for Save. While a save is on its way a field counts as unsaved against the value being stored, so what is typed meanwhile is neither lost nor passed over.
 * A switch or a choice shows its new value at once and is sent; once the last such save has its answer the rows are read again, so a refused one goes back to what is stored.
 */
export function SettingGroup({ group, says, onUnsaved, children }: SettingGroupProps): ReactNode {
  const heading = useId();
  const [typed, setTyped] = useState<Texts>({});
  const [refusal, setRefusal] = useState<Refusal>();
  const [chosen, setChosen] = useState<boolean>();

  // A refusal about one of the group's settings shows at that setting's field, which takes the focus; any other is a line.
  const refuse = (error: Error): void => {
    const refused = error instanceof Refused ? error : undefined;
    const about = group.rows.find((row) => row.key === refused?.about);
    if (refused === undefined || about === undefined) {
      sayRefused(refused?.message ?? FAULT);

      return;
    }

    setRefusal({ key: about.key, sentence: refused.message });
    setChosen(undefined);
    window.requestAnimationFrame(() => document.getElementById(controlId(about.key))?.focus());
  };
  const sentAs = (key: string, value: string): string | undefined => {
    const row = group.rows.find((entry) => entry.key === key);

    return row === undefined ? undefined : sentOf(row, value);
  };
  const { saving, saveNow } = useSaves(refuse, (texts) => {
    // What was typed while the save was on its way stays typed.
    setTyped((kept) => Object.fromEntries(Object.entries(kept).filter(([key, value]) => sentAs(key, value) !== texts[key])));
    setRefusal(undefined);
  });

  const shown = (row: Row): string => typed[row.key] ?? shownOf(row);
  const onItsWay: Texts = saving.isPending ? saving.variables.texts : {};
  const edited = group.rows.filter((row) => !row.elsewhere && !savesAtOnce(row) && sentOf(row, shown(row)) !== (onItsWay[row.key] ?? row.text));
  const saves = group.rows.some((row) => !row.elsewhere && !savesAtOnce(row));
  const unsaved = edited.length > 0;
  const open = chosen ?? (!group.folded || unsaved || refusal !== undefined || group.rows.some((row) => row.warning !== null));

  useEffect(() => {
    onUnsaved(group.id, unsaved);

    return () => onUnsaved(group.id, false);
  }, [onUnsaved, group.id, unsaved]);

  const change = (row: Row, value: string): void => {
    if (refusal?.key === row.key) setRefusal(undefined);
    if (savesAtOnce(row)) saveNow(row, value);
    else setTyped((kept) => ({ ...kept, [row.key]: value }));
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (edited.length === 0 || saving.isPending) return;

    saving.mutate({
      texts: Object.fromEntries(edited.map((row) => [row.key, sentOf(row, shown(row))])),
      before: Object.fromEntries(edited.map((row) => [row.key, row.text])),
    });
  };

  return (
    <form onSubmit={save} aria-labelledby={heading} noValidate>
      <Collapsible open={open} onOpenChange={setChosen}>
        <GroupHead id={heading} group={group} open={open} save={saves ? { ready: unsaved, busy: saving.isPending } : undefined} />
        <CollapsibleContent>
          {says === undefined ? null : <p className="border-b px-6 py-2.5 text-[13px] text-muted-foreground max-md:px-4">{says}</p>}
          {group.rows.map((row) => (
            <SettingRow
              key={row.key}
              row={row}
              shown={shown(row)}
              refusal={refusal?.key === row.key ? refusal.sentence : undefined}
              onChange={(value) => change(row, value)}
            />
          ))}
          {children}
        </CollapsibleContent>
      </Collapsible>
    </form>
  );
}
