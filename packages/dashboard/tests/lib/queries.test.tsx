// How long a read of the dashboard stands: what a person's own change does to it, how long the visits graph's days stand, and what a hidden page does to a read that repeats.

import { afterEach, describe, expect, jest, setSystemTime, spyOn, test } from "bun:test";
import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { api } from "@/lib/api";
import { useStarted } from "@/lib/frame";
import { QUERIES } from "@/lib/queries";
import { useVisits } from "@/usage/visits-queries";

/** A second, in milliseconds. */
const SECOND = 1000;

/** How often the repeating read of the last test asks, in milliseconds. */
const EVERY = 60 * SECOND;

/** The choice the graph's days are read for. */
const CHOICE = { range: "30", sites: [], hidden: [] } as const;

/** Answer the client's calls as a server that did what was asked, or refused it, and keep the calls. */
function server(status: number): ReturnType<typeof spyOn<typeof globalThis, "fetch">> {
  return spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ ok: status < 400 }, { status })) as unknown as typeof fetch);
}

/** Draw a part that reads through the dashboard's own place for data. */
function inQueries({ children }: { readonly children: ReactNode }): ReactNode {
  return <QueryClientProvider client={QUERIES}>{children}</QueryClientProvider>;
}

/** Let the clock go on so far. */
function pass(ms: number): void {
  setSystemTime(new Date(Date.now() + ms));
}

/** Show or hide the page, as a browser does with a tab that is left or come back to. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  window.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  setSystemTime();
  setHidden(false);
  QUERIES.clear();
});

describe("a read of the dashboard", () => {
  // Drift: a person's own change would show on the next screen only half a minute later; or a read alone, or a refused change, would make every screen read again.
  test.each([
    ["a change that was done", 200, "post", 2],
    ["a change that was refused", 400, "post", 1],
    ["a read", 200, "get", 1],
  ] as const)("is old at once after %s", async (_what, status, call, asks) => {
    let asked = 0;
    const read = { queryKey: ["sites", "page"], queryFn: () => ++asked };
    await QUERIES.fetchQuery(read);
    {
      using _answering = server(status);
      await (call === "post" ? api.settings["sign-everyone-out"].$post({ json: {} }) : api.frame.$get());
    }
    await QUERIES.fetchQuery(read);

    expect(asked).toBe(asks);
  });

  // Drift: a change made anywhere would take back the note that an update was started from this page, and the frame would offer the update again.
  test("that only notes what this page did keeps its note through a change", async () => {
    const { result, rerender } = renderHook(() => useStarted(), { wrapper: inQueries });
    act(() => result.current[1]());
    {
      using _answering = server(200);
      await api.settings["sign-everyone-out"].$post({ json: {} });
    }
    rerender();
    const again = renderHook(() => useStarted(), { wrapper: inQueries });
    // A read that a part drawn anew starts is waited for: it would take the note back only once it ends.
    await act(async () => {
      await Promise.all(QUERIES.getQueryCache().getAll().map((query) => query.promise));
      await new Promise((drawn) => setTimeout(drawn, 0));
    });

    expect([result.current[0], again.result.current[0]]).toEqual([true, true]);
  });

  // Drift: the graph's reads would be kept under another key than the one that gives them five minutes, and every look at the window would walk its rows again.
  test.each([
    ["4 minutes 59 seconds on", 299 * SECOND, 1],
    ["5 minutes 1 second on", 301 * SECOND, 2],
  ] as const)("of the visits graph's days stands five minutes: %s", async (_what, later, asks) => {
    using answering = server(200);
    setSystemTime(new Date(Date.UTC(2026, 10, 16, 12)));
    const first = renderHook(() => useVisits(CHOICE), { wrapper: inQueries });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    pass(later);
    const second = renderHook(() => useVisits(CHOICE), { wrapper: inQueries });
    await waitFor(() => expect(second.result.current.isFetching).toBe(false));

    expect(answering.mock.calls.length).toBe(asks);
  });

  // Drift: a page left open in a tab nobody looks at would go on asking the server by the clock, all day.
  test("that repeats by the clock rests while the page is hidden, and goes on when it is shown", async () => {
    jest.useFakeTimers();
    try {
      QUERIES.mount();
      let asked = 0;
      const stop = new QueryObserver(QUERIES, { queryKey: ["frame"], queryFn: () => ++asked, refetchInterval: EVERY }).subscribe(() => undefined);
      // One step of the clock at a time, each read settled before the next: a read still under way would swallow the asks that follow it.
      const after = async (steps: number): Promise<number> => {
        for (let step = 0; step < steps; step++) {
          jest.advanceTimersByTime(EVERY);
          await QUERIES.getQueryCache().find({ queryKey: ["frame"] })?.promise;
        }

        return asked;
      };
      await QUERIES.getQueryCache().find({ queryKey: ["frame"] })?.promise;

      setHidden(true);
      const hidden = await after(5);
      setHidden(false);
      const shown = await after(2);
      stop();
      QUERIES.unmount();

      expect([hidden, shown]).toEqual([1, 3]);
    } finally {
      jest.useRealTimers();
    }
  });
});
