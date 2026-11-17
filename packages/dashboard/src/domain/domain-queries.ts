// How the Domain screen reads its data: what a token must hold and the last run the install remembers, in one read, and the pieces on show, which a run made here replaces.
//
//   an install whose check needs no token    the remembered run shows at once; opening the screen checks again when there is none, or it is older than `CHECK_FRESH_MS`
//   an install whose check needs a token     the remembered run shows until a run is made from the dialog
//
// The line counts every mark under it that a repair ends: the pieces of the run that wait for one, and the problems of the domain that say to press Repair.
// Those problems are drawn under the line from the frame, and the frame names them, so the line and what is under it never say different things.
// A repair that left no work counts the same marks as done: the pieces it changed, and the problems that asked for it and are gone, which the screen then names.
//
// The pieces on show are forgotten when the screen is left, so the screen always opens on what the install remembers.

import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useRef, useState } from "react";

import { answerOf, api } from "@/lib/api";
import { FRAME_KEY, type Frame, useFrame } from "@/lib/frame";

/** The key the screen's data is kept under: a run marks it stale, so it is read again. */
export const DOMAIN_KEY = ["domain"] as const;

/** The key the pieces on show are kept under. No part of it is the key above, so reading the screen's data again starts no check. */
const PIECES_KEY = ["domain-pieces"] as const;

/** How old a check may be and still be gone by when the screen opens, in milliseconds: 10 minutes. An older one is made again there, on an install whose check needs no token. */
export const CHECK_FRESH_MS = 600_000;

/** No problem: what a run that was no repair ended. */
const NONE: Frame["domainAsks"] = [];

/** What the screen opens with, as the server answers it. */
export type Domain = InferResponseType<typeof api.domain.$get, 200>;

/** A run that read its pieces, as the server answers it. */
export type Ran = InferResponseType<typeof api.domain.check.$post, 200>;

/** Which run it is: one that only reads the pieces, or one that also repairs them. */
export type DomainRun = NonNullable<Domain["last"]>["run"];

/** The pieces the screen shows, and the runs that replace them. */
interface Pieces {
  /** The run on show: one made here, else the one the install remembers, else none. */
  readonly ran: Ran | undefined;

  /** The remembered run to name beside the count: none before any, and none while the newest run is one made here that the screen's data does not hold yet. */
  readonly last: NonNullable<Domain["last"]> | undefined;

  /** Whether a check that needs no token is on its way. */
  readonly checking: boolean;

  /** Why the last such check read nothing, in the server's sentence. */
  readonly failure: string | undefined;

  /** The problems that asked for a repair and that the repair on show ended, each by its sentence: the line counts them as repaired. None for any other run. */
  readonly mended: Frame["domainAsks"];

  /** Check again with no token, as a press does. It answers the run as it is then shown, or nothing for a check that read no pieces, which `failure` then says. */
  readonly check: () => Promise<Ran | undefined>;

  /** Take a run made from the dialog as the pieces on show. It answers the run as it is then shown. */
  readonly take: (run: DomainRun, ran: Ran) => Promise<Ran>;
}

/** What is known of the newest run made here: when the remembered run was as it ended, and for a repair the problems that asked for one before it. */
interface Ended {
  readonly at: number | undefined;
  readonly asked: Frame["domainAsks"];
}

/**
 * A run as the screen shows it: its line counts its pieces that wait for a repair and the problems drawn under it that ask for one. A line that says anything else of work that is left, such as what a repair did not do, stays.
 * A repair that left no work counts what it ended the same way: the pieces it changed and the problems that asked for it.
 */
function shownOf(ran: Ran, asks: Frame["domainAsks"], mended: Frame["domainAsks"]): Ran {
  if (ran.summary.tone === "bad" && ran.waiting === 0) return ran;

  if (asks.length > 0) return { ...ran, summary: { line: `${ran.waiting + asks.length} to repair`, tone: "bad" } };

  return mended.length === 0 || ran.summary.tone === "bad" ? ran : { ...ran, summary: { line: `${ran.repaired + mended.length} repaired`, tone: "good" } };
}

/** The remembered run as a run made here is held: it names no step for a person. */
function rememberedOf(last: NonNullable<Domain["last"]>): Ran {
  return { ok: true, rows: last.rows, steps: [], summary: last.summary, waiting: last.waiting, repaired: last.repaired };
}

/** The problems that asked for a repair and ask no more. */
function goneFrom(asked: Frame["domainAsks"], left: Frame["domainAsks"]): Frame["domainAsks"] {
  return asked.filter((sentence) => !left.includes(sentence));
}

/** Read what the Domain screen opens with. */
export function useDomain(): UseQueryResult<Domain> {
  return useQuery({ queryKey: DOMAIN_KEY, queryFn: () => answerOf(api.domain.$get()) });
}

/**
 * Hold the pieces the screen shows.
 *
 * @param domain - what the screen opened with; the remembered run in it is the first thing on show, and its age decides whether a check is made at once
 * @returns the pieces, with the check and the run that replace them. A check nobody pressed says so to the server, which then writes no line of it into Activity
 */
export function useDomainPieces(domain: Domain): Pieces {
  const client = useQueryClient();
  const pressed = useRef(false);
  // When the remembered run was as the newest run here ended: that run is named beside the count only once the screen's data holds a newer one.
  const [before, setBefore] = useState<Ended>();
  const { last } = domain;
  const { domainAsks } = useFrame().data;
  // What asked for a repair before the one on show and asks no more is what that repair ended. It is told from the frame as it is read now, so a frame that could not be read right after the repair names the problem once it is.
  const mended = goneFrom(before?.asked ?? NONE, domainAsks);
  // The side says what the domain needs, which a run changes, and a repair ends the problems that asked for it: the frame is read again before the run is shown, so its line is never said over problems that are gone.
  const framed = (): Promise<void> => client.invalidateQueries({ queryKey: FRAME_KEY });
  const asksNow = (): Frame["domainAsks"] => client.getQueryData<Frame>(FRAME_KEY)?.domainAsks ?? NONE;
  const ended = (asked: Frame["domainAsks"] = NONE): void => {
    setBefore({ at: last?.ran_at, asked });
    void client.invalidateQueries({ queryKey: DOMAIN_KEY });
  };

  const pieces = useQuery({
    queryKey: PIECES_KEY,
    queryFn: async (): Promise<Ran> => {
      const unasked = !pressed.current;
      pressed.current = false;
      const ran = await answerOf(api.domain.check.$post({ json: { unasked } }));
      await framed();
      ended();

      return ran;
    },
    enabled: domain.checks_alone,
    ...(last === null ? {} : { initialData: rememberedOf(last), initialDataUpdatedAt: last.ran_at }),
    staleTime: CHECK_FRESH_MS,
    gcTime: 0,
  });

  // Until a run ends here the remembered run is shown as the screen's data has it now, which another screen's change may have read again.
  const ran: Ran | undefined = before === undefined && last !== null ? rememberedOf(last) : pieces.data;

  return {
    ran: ran === undefined ? undefined : shownOf(ran, domainAsks, mended),
    last: last !== null && (before === undefined || last.ran_at !== before.at) ? last : undefined,
    checking: pieces.isFetching,
    failure: pieces.error?.message,
    mended,
    check: async () => {
      pressed.current = true;
      const again = await pieces.refetch();

      return again.status === "success" ? shownOf(again.data, asksNow(), NONE) : undefined;
    },
    take: async (run, taken) => {
      await framed();
      const [asked, left] = [run === "repair" ? domainAsks : NONE, asksNow()];
      client.setQueryData(PIECES_KEY, taken);
      ended(asked);

      return shownOf(taken, left, goneFrom(asked, left));
    },
  };
}
