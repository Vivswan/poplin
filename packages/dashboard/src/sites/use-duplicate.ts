// A copy of a site. The dialog sends the first request, which refuses a name or copies a small site whole; the requests after it are background work of the client, so they go on while a person moves between screens.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { useCallback } from "react";

import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused, sayWorking, unsay } from "@/lib/notify";
import type { Site } from "@/lib/sites";
import { SITES_KEY } from "@/sites/site-queries";

/** The key the background work of every copy is kept under. */
const COPY_KEY = [...SITES_KEY, "duplicate"] as const;

/** What is said of a copy whose request copied no file more: asking again would never end. */
const STUCK = "The copy stopped. Duplicate the site again.";

/** What one request of a copy answers. */
type Round = InferResponseType<(typeof api.sites)[":site"]["duplicate"]["$post"], 200>;

/** A copy that goes on in the background. */
interface Run {
  /** The site that is copied. */
  readonly source: Site;

  /** How far the first request left the copy. */
  readonly copy: Round["copy"];

  /** Aborted once a person stops the copy. */
  readonly stopped: AbortSignal;

  /** Opens the panel of the copy once it is a site. */
  readonly open: (site: Site) => void;
}

/** How a copy ended: as a site, given up at a person's word, or refused. A site whose answer was lost is made all the same, and not known. */
type Ended = { readonly kind: "made"; readonly site: Site | undefined } | { readonly kind: "cancelled" } | { readonly kind: "refused"; readonly sentence: string };

/** What became of a copy that was given up: gone with its files, a site all the same, or still there, with the sentence of the cancel that did not work. */
type GivenUp = { readonly kind: "gone" } | Extract<Ended, { readonly kind: "made" }> | { readonly kind: "kept"; readonly sentence: string };

/** The name of the line that says a copy goes on. */
function lineOf(copy: Round["copy"]): string {
  return `copy ${copy.upload}`;
}

function ask(source: Site, json: { readonly name: string } | { readonly upload: string }): Promise<Round> {
  // The id names the site whatever its label becomes while the copy is made.
  return answerOf(api.sites[":site"].duplicate.$post({ param: { site: source.id }, json }));
}

/**
 * Ask for the files after the first request's, one request after another.
 *
 * @returns the copy as a site, or nothing once a person stopped it
 * @throws {Refused} a request was refused, or copied nothing more
 */
async function copyOn({ source, copy, stopped }: Run): Promise<Site | undefined> {
  for (let copied = copy.copied; !stopped.aborted; ) {
    const round = await ask(source, { upload: copy.upload });
    if (round.site !== null) return round.site;

    if (round.copy.copied <= copied) throw new Refused({ code: "stuck", about: null, sentence: STUCK });

    copied = round.copy.copied;
  }

  return undefined;
}

/** Give a copy up, with its files. */
async function giveUp({ source, copy }: Run): Promise<GivenUp> {
  try {
    await answerOf(api.copies[":upload"].cancel.$post({ param: { upload: copy.upload }, json: {} }));

    return { kind: "gone" };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;

    // A copy that is gone already is given up.
    if (error.code === "not_found") return { kind: "gone" };

    if (error.code !== "upload_finished") return { kind: "kept", sentence: error.message };
  }

  // The copy became a site though its answer was lost: the answer is asked for once more, and the copy is a site whether or not it comes.
  const made = await ask(source, { upload: copy.upload }).catch(() => undefined);

  return { kind: "made", site: made?.site ?? undefined };
}

/** Make the rest of a copy. A copy that is refused or stopped is given up, so no half of it stays. */
async function finishCopy(run: Run): Promise<Ended> {
  let refusal: string | undefined;
  try {
    const site = await copyOn(run);
    if (site !== undefined) return { kind: "made", site };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;

    refusal = error.message;
  }

  const became = await giveUp(run);
  if (became.kind === "made") return became;

  const sentence = refusal ?? (became.kind === "kept" ? became.sentence : undefined);

  return sentence === undefined ? { kind: "cancelled" } : { kind: "refused", sentence };
}

/**
 * Say how a copy ended. A copy that is a site offers the way to it.
 *
 * @param line - the name of the line that said the copy goes on, whose place this one takes; none for a copy that one request made
 */
function sayEnded(ended: Ended, open: Run["open"], line?: string): void {
  if (ended.kind === "refused") {
    sayRefused(ended.sentence, line);

    return;
  }

  if (ended.kind === "cancelled") {
    sayDone("Cancelled. No copy was made.", undefined, line);

    return;
  }

  const { site } = ended;
  sayDone("Duplicated.", site === undefined ? undefined : { label: "Open", run: () => open(site), id: line ?? `copied ${site.id}` }, line);
}

/**
 * Start copies of sites.
 *
 * @returns a function that begins a copy under a name. It answers the sentence of a refused name, for the field the name was typed in, and nothing otherwise: whatever else becomes of the copy is said in a line
 */
export function useDuplicate(): (source: Site, name: string) => Promise<string | undefined> {
  const client = useQueryClient();
  const navigate = useNavigate();
  // The list is read again however a copy ended: one whose answer was lost may be a site all the same.
  const listAgain = useCallback((): void => void client.invalidateQueries({ queryKey: SITES_KEY }), [client]);
  // The work is the client's and not the screen's: it goes on, and says how it ended, after the screen that began it is left.
  const { mutate } = useMutation({
    mutationKey: COPY_KEY,
    mutationFn: finishCopy,
    onSuccess: (ended, run) => sayEnded(ended, run.open, lineOf(run.copy)),
    // A fault of the client's own says nothing of the copy: its line leaves.
    onError: (_error, run) => unsay(lineOf(run.copy)),
    onSettled: listAgain,
  });

  return useCallback(
    async (source, name) => {
      const open: Run["open"] = (site) => void navigate({ to: "/sites/$label", params: { label: site.label } });
      let first: Round;
      try {
        first = await ask(source, { name });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;

        if (error.about === "name") return error.message;

        listAgain();
        sayRefused(error.message);

        return undefined;
      }

      if (first.site !== null) {
        listAgain();
        sayEnded({ kind: "made", site: first.site }, open);

        return undefined;
      }

      const stop = new AbortController();
      sayWorking("Duplicating. Ready in a few seconds.", { label: "Cancel", run: () => stop.abort(), id: lineOf(first.copy) });
      mutate({ source, copy: first.copy, stopped: stop.signal, open });

      return undefined;
    },
    [listAgain, mutate, navigate],
  );
}
