// The changes of the Settings screen that wait for Save: what each changed control holds, the one request that saves them together, the refusal that comes back at its field, and the Undo of a done save.

import { MutationObserver, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { type Row, SETTINGS_KEY, SETTINGS_SAVES_KEY, type Settings } from "@/settings/settings-queries";

/** What is shown when a save fails for a reason that is no refusal. */
const FAULT = "That did not work. Try again.";

/** What every save of a setting shares: they are sent one after another, in the order they were made, so the last value is the one stored. */
const IN_ORDER = { id: "settings-saves" } as const;

/** The texts of some settings, by key. */
type Texts = Readonly<Record<string, string>>;

/** A refusal of a save: the setting it is about, and the sentence. */
interface Refusal {
  readonly key: string;
  readonly sentence: string;
}

/** The waiting changes of the screen and what is done with them. */
interface Draft {
  /** The text a row's control shows: the one a change waits with, or the stored one. */
  readonly shown: (row: Row) => string;

  /** The rows whose control holds another text than the stored one, or than the one a save on its way stores. */
  readonly pending: readonly Row[];

  /** The refusal of the last save, until its setting is changed again. */
  readonly refusal: Refusal | undefined;

  /** Whether a save is on its way. */
  readonly busy: boolean;

  /** Hold a new text for a row. */
  readonly change: (row: Row, text: string) => void;

  /** Drop every waiting change and the refusal. */
  readonly discard: () => void;

  /** Send every waiting change in one request. It answers whether nothing is left refused: `true` also when nothing waited. */
  readonly save: () => Promise<boolean>;
}

/** Send a save of some settings: all of them are stored, or on a refusal none. */
function sendSave(texts: Texts): Promise<unknown> {
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
  return client.isMutating({ mutationKey: SETTINGS_SAVES_KEY }) === 1 ? client.invalidateQueries({ queryKey: SETTINGS_KEY }) : undefined;
}

/** Take a done save back: store the texts from before it through the same route, in its turn among the saves, and say so. A refusal is said as a line. The line's Undo may be pressed after the screen is gone, so the save is the page's own. */
function putBack(client: QueryClient, texts: Texts): void {
  const undo = new MutationObserver(client, {
    scope: IN_ORDER,
    mutationKey: SETTINGS_SAVES_KEY,
    mutationFn: sendSave,
    onSuccess: () => sayDone("Put back."),
    onError: (error) => sayRefused(error instanceof Refused ? error.message : FAULT),
    onSettled: () => readAfterLast(client),
  });
  // The texts show at the press, so a change made after it is shown over them and not under.
  showStored(client, texts);
  void undo
    .mutate(texts)
    .catch(() => undefined)
    .finally(() => undo.reset());
}

/**
 * Keep the waiting changes of the rows.
 *
 * While a save is on its way a control counts as changed against the text being stored, so what is changed meanwhile is neither lost nor passed over.
 *
 * @param onRefused - called with the key of the setting a save was refused about, so the screen can show its field
 */
export function useDraft(rows: readonly Row[], onRefused: (key: string) => void): Draft {
  const client = useQueryClient();
  const [held, setHeld] = useState<Texts>({});
  const [refusal, setRefusal] = useState<Refusal>();

  const saving = useMutation({
    scope: IN_ORDER,
    mutationKey: SETTINGS_SAVES_KEY,
    mutationFn: (save: { readonly texts: Texts; readonly before: Texts }) => sendSave(save.texts),
    onError: (error) => {
      const about = error instanceof Refused ? rows.find((row) => row.key === error.about) : undefined;
      // A refusal about one of the settings shows at that setting's field; any other is a line.
      if (about === undefined) return sayRefused(error instanceof Refused ? error.message : FAULT);

      setRefusal({ key: about.key, sentence: error.message });
      onRefused(about.key);
    },
    // The stored texts show before the save stops counting as on its way, so no control is compared with a text from before it.
    onSuccess: (_done, save) => {
      showStored(client, save.texts);
      // What was changed while the save was on its way stays changed.
      setHeld((kept) => Object.fromEntries(Object.entries(kept).filter(([key, text]) => text !== save.texts[key])));
      setRefusal(undefined);
      sayDone("Saved.", { run: () => putBack(client, save.before) });
    },
    onSettled: () => readAfterLast(client),
  });

  const shown = (row: Row): string => held[row.key] ?? row.text;
  const onItsWay: Texts = saving.isPending ? saving.variables.texts : {};
  const pending = rows.filter((row) => shown(row) !== (onItsWay[row.key] ?? row.text));

  const change = (row: Row, text: string): void => {
    if (refusal?.key === row.key) setRefusal(undefined);
    setHeld((kept) => ({ ...kept, [row.key]: text }));
  };

  const discard = (): void => {
    setHeld({});
    setRefusal(undefined);
  };

  const save = async (): Promise<boolean> => {
    if (pending.length === 0) return true;

    const texts = Object.fromEntries(pending.map((row) => [row.key, shown(row)]));
    const before = Object.fromEntries(pending.map((row) => [row.key, row.text]));

    return saving.mutateAsync({ texts, before }).then(
      () => true,
      () => false,
    );
  };

  return { shown, pending, refusal, busy: saving.isPending, change, discard, save };
}
