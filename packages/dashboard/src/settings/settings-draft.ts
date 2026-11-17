// The changes of the Settings screen that wait for Save: what each changed control holds, the one request that saves them together, the refusal that comes back at its field, and the Undo of a done save.

import { MutationObserver, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useState } from "react";

import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused } from "@/lib/notify";
import { isOn, switchText } from "@/settings/setting-values";
import { type Row, SETTINGS_KEY, SETTINGS_SAVES_KEY, type Settings } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";
import { SITES_KEY } from "@/sites/site-queries";

/** What is shown when a save fails for a reason that is no refusal. */
const FAULT = "That did not work. Try again.";

/** What every save of a setting shares: they are sent one after another, in the order they were made, so the last value is the one stored. */
const IN_ORDER = { id: "settings-saves" } as const;

/** When a saved setting takes effect whose half at the provider waits: at the next repair of the domain, or, for one the next upload of the install's code states too, at whichever comes first. */
const UNTIL = { repair: "at the next Repair", update: "at the next update or Repair" } as const;

/** What a done save answers: the saved settings whose half at the provider waits, by what it waits for. */
type Saved = InferResponseType<typeof api.settings.$post, 200>;

/** The texts of some settings, by key. */
type Texts = Readonly<Record<string, string>>;

/** The refusals of a save: the sentence of each refused setting, by its key. */
type Refusals = Readonly<Record<string, string>>;

/** The waiting changes of the screen and what is done with them. */
interface Draft {
  /** The text a row's control shows: the one a change waits with, or the stored one. */
  readonly shown: (row: Row) => string;

  /** The rows whose control holds another text than the stored one, or than the one a save on its way stores. */
  readonly pending: readonly Row[];

  /** What the last save was refused about: each setting's sentence, until that setting is changed again. */
  readonly refusals: Refusals;

  /** Whether a save is on its way. */
  readonly busy: boolean;

  /** Hold a new text for a row. */
  readonly change: (row: Row, text: string) => void;

  /** Drop every waiting change and the refusal. */
  readonly discard: () => void;

  /** Send every waiting change in one request. It answers whether nothing is left refused: `true` also when nothing waited. */
  readonly save: () => Promise<boolean>;
}

/** The sentence of every setting a save was refused about: each one the answer lists, or the one it is about. */
function refusalsOf(refused: Refused): Refusals {
  if (refused.each.length > 0) return Object.fromEntries(refused.each.map((field) => [field.about, field.sentence]));

  return refused.about === null ? {} : { [refused.about]: refused.message };
}

/** Send a save of some settings: all of them are stored, or on a refusal none. */
function sendSave(texts: Texts): Promise<Saved> {
  return answerOf(api.settings.$post({ json: { texts } }));
}

/**
 * What the line of a done save says after "Saved.": when the saved settings take effect, where the provider's side of some of them waits.
 *
 * @param count - how many settings the save held
 * @returns nothing for a save that waits for nothing; the settings are counted where only some of them wait
 */
function nextOf({ waits }: Saved, count: number): string | undefined {
  const waiting = waits.repair.length + waits.update.length;
  if (waiting === 0) return undefined;

  const until = waits.repair.length > 0 ? UNTIL.repair : UNTIL.update;
  if (waiting === count) return `Takes effect ${until}.`;

  return waiting === 1 ? `1 setting takes effect ${until}.` : `${waiting} settings take effect ${until}.`;
}

/** Show some settings as stored with new texts, before the rows are read again. A read already on its way is dropped: it holds the texts from before. */
function showStored(client: QueryClient, texts: Texts): void {
  void client.cancelQueries({ queryKey: SETTINGS_KEY });
  client.setQueryData<Settings>(SETTINGS_KEY, (kept) =>
    kept === undefined ? kept : { ...kept, rows: kept.rows.map((row) => (Object.hasOwn(texts, row.key) ? { ...row, text: texts[row.key] ?? row.text } : row)) },
  );
}

/** Read the rows again once the last save of a run has its answer: an earlier read would undo, on the screen, a change still on its way. A site's panel shows a setting of the install too, so the sites are read again with them. */
function readAfterLast(client: QueryClient): Promise<void> | undefined {
  if (client.isMutating({ mutationKey: SETTINGS_SAVES_KEY }) !== 1) return undefined;

  void client.invalidateQueries({ queryKey: SITES_KEY });

  return client.invalidateQueries({ queryKey: SETTINGS_KEY });
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
 * @param onRefused - called with the key of the first setting on the screen a save was refused about, so the screen can show its field
 */
export function useDraft(rows: readonly Row[], onRefused: (key: string) => void): Draft {
  const client = useQueryClient();
  const [held, setHeld] = useState<Texts>({});
  const [refusals, setRefusals] = useState<Refusals>({});

  const saving = useMutation({
    scope: IN_ORDER,
    mutationKey: SETTINGS_SAVES_KEY,
    mutationFn: (save: { readonly texts: Texts; readonly before: Texts }) => sendSave(save.texts),
    onError: (error) => {
      const said = error instanceof Refused ? refusalsOf(error) : {};
      const [first] = rows.filter((row) => Object.hasOwn(said, row.key));
      // A refusal about settings shows at each of their fields; any other is a line.
      if (first === undefined) return sayRefused(error instanceof Refused ? error.message : FAULT);

      setRefusals(said);
      onRefused(first.key);
    },
    // The stored texts show before the save stops counting as on its way, so no control is compared with a text from before it.
    onSuccess: (done, save) => {
      showStored(client, save.texts);
      // What was changed while the save was on its way stays changed.
      setHeld((kept) => Object.fromEntries(Object.entries(kept).filter(([key, text]) => text !== save.texts[key])));
      setRefusals({});
      const next = nextOf(done, Object.keys(save.texts).length);
      sayDone("Saved.", { run: () => putBack(client, save.before), ...(next === undefined ? {} : { next }) });
    },
    onSettled: () => readAfterLast(client),
  });

  // A switch that does nothing without another one is off for as long as that other one is off, held or stored, whatever is held or stored for it: a pair that cannot work is never sent.
  // What is held for it stays, and shows again once the other one is on.
  const shown = (row: Row): string => {
    const text = held[row.key] ?? row.text;
    const needed = rows.find((other) => other.key === wordsOf(row.key).needs);

    return needed !== undefined && !isOn(needed, held[needed.key] ?? needed.text) && isOn(row, text) ? switchText(row, false) : text;
  };
  const onItsWay: Texts = saving.isPending ? saving.variables.texts : {};
  const pending = rows.filter((row) => shown(row) !== (onItsWay[row.key] ?? row.text));

  const change = (row: Row, text: string): void => {
    if (Object.hasOwn(refusals, row.key)) setRefusals((kept) => Object.fromEntries(Object.entries(kept).filter(([key]) => key !== row.key)));
    setHeld((kept) => ({ ...kept, [row.key]: text }));
  };

  const discard = (): void => {
    setHeld({});
    setRefusals({});
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

  return { shown, pending, refusals, busy: saving.isPending, change, discard, save };
}
