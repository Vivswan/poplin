// How the Domain screen reads its data: what a token must hold and the last run the install remembers, in one read, and the pieces on show, which a run made here replaces.
//
//   an install whose check needs no token    the remembered run shows at once; opening the screen checks again when there is none, or it is older than `CHECK_FRESH_MS`
//   an install whose check needs a token     the remembered run shows until a run is made from the dialog
//
// The line of a run is its own count of its pieces. Where that says nothing is left while the frame holds problems of the domain that say to press Repair, the frame's count of those is the line:
// the problems are drawn under it from the same frame, so the two never say different things.
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

  /** Check again with no token, as a press does. It answers the run as it is then shown, or nothing for a check that read no pieces, which `failure` then says. */
  readonly check: () => Promise<Ran | undefined>;

  /** Take a run made from the dialog as the pieces on show. It answers the run as it is then shown. */
  readonly take: (ran: Ran) => Promise<Ran>;
}

/** A run as the screen shows it: with its own line, or, where that says nothing is left, with what the problems drawn under it ask for. */
function shownOf(ran: Ran, asks: Frame["domainAsks"]): Ran {
  return ran.summary.tone === "good" && asks !== null ? { ...ran, summary: asks } : ran;
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
  const [before, setBefore] = useState<{ readonly at: number | undefined }>();
  const { last } = domain;
  const { domainAsks } = useFrame().data;
  // The side says what the domain needs, which a run changes, and a repair ends the problems that asked for it: the frame is read again before the run is shown, so its line is never said over problems that are gone.
  const framed = (): Promise<void> => client.invalidateQueries({ queryKey: FRAME_KEY });
  const asksNow = (): Frame["domainAsks"] => client.getQueryData<Frame>(FRAME_KEY)?.domainAsks ?? null;
  const ended = (): void => {
    setBefore({ at: last?.ran_at });
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
    ...(last === null ? {} : { initialData: { ok: true as const, rows: last.rows, steps: [], summary: last.summary }, initialDataUpdatedAt: last.ran_at }),
    staleTime: CHECK_FRESH_MS,
    gcTime: 0,
  });

  // Until a run ends here the remembered run is shown as the screen's data has it now, which another screen's change may have read again.
  const ran: Ran | undefined = before === undefined && last !== null ? { ok: true, rows: last.rows, steps: [], summary: last.summary } : pieces.data;

  return {
    ran: ran === undefined ? undefined : shownOf(ran, domainAsks),
    last: last !== null && (before === undefined || last.ran_at !== before.at) ? last : undefined,
    checking: pieces.isFetching,
    failure: pieces.error?.message,
    check: async () => {
      pressed.current = true;
      const again = await pieces.refetch();

      return again.status === "success" ? shownOf(again.data, asksNow()) : undefined;
    },
    take: async (taken) => {
      await framed();
      client.setQueryData(PIECES_KEY, taken);
      ended();

      return shownOf(taken, asksNow());
    },
  };
}
