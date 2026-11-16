// The client of the data routes: what every call says of itself, and what a login that ended does to the page.
// And how long an answer stands: what a person's own change does to it, how long the visits graph's days stand, and what a hidden page does to a read that repeats.

import { afterEach, describe, expect, jest, type Mock, setSystemTime, spyOn, test } from "bun:test";
import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { answerOf, api, QUERIES, Refused } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import { useStarted } from "@/lib/frame";
import { useVisits } from "@/usage/visits-queries";

/** The line a login that ended leaves on a page that holds unsaved typing. */
const LOG_IN_AGAIN = "Your login ended. Log in again in a new tab, then try again here.";

/** A second, in milliseconds. */
const SECOND = 1000;

/** How often the repeating read of the last test asks, in milliseconds. */
const EVERY = 60 * SECOND;

/** The choice the graph's days are read for. */
const CHOICE = { range: "30", sites: [], hidden: [] } as const;

/** The provider's own answer to a script's call whose login ended: a page, and no JSON. */
function providersRefusal(): Response {
  return new Response("<html><body>Unauthorized</body></html>", { status: 401, headers: { "Content-Type": "text/html" } });
}

/** Answer every call of the client with what `answer` makes, and keep the calls. */
function serverOf(answer: () => Response): Mock<typeof fetch> {
  return spyOn(globalThis, "fetch").mockImplementation((async () => answer()) as unknown as typeof fetch);
}

/** Ask one data route and say what the call was refused as. */
async function refusalOf(asked: Parameters<typeof answerOf>[0]): Promise<readonly [code: string, sentence: string] | "answered"> {
  try {
    await answerOf(asked);

    return "answered";
  } catch (error) {
    if (!(error instanceof Refused)) throw error;

    return [error.code, error.message];
  }
}

/** Have the page ask before it is left, as a form with unsaved typing does, until the returned function is called. */
function holdUnsaved(): () => void {
  const ask = (event: Event): void => event.preventDefault();
  window.addEventListener("beforeunload", ask);

  return () => window.removeEventListener("beforeunload", ask);
}

/** Answer the client's calls as a server that did what was asked, or refused it, and keep the calls. */
function server(status: number): ReturnType<typeof spyOn<typeof globalThis, "fetch">> {
  return spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ ok: status < 400 }, { status })) as unknown as typeof fetch);
}

/** Draw a part that reads through the dashboard's own place for data. */
function inQueries({ children }: { readonly children: ReactNode }): ReactNode {
  return <QueryClientProvider client={QUERIES}>{children}</QueryClientProvider>;
}

/** Show or hide the page, as a browser does with a tab that is left or come back to. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  window.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  for (const shown of toast.getToasts()) toast.dismiss(shown.id);
  setSystemTime();
  setHidden(false);
  QUERIES.clear();
});

describe("every call of the client", () => {
  // Drift: without the header the provider answers a call whose login ended with a redirect to its login page, which a script cannot follow: the screen would say the server failed, and never lead back in.
  test("says it comes from a script, a read and a change alike", async () => {
    using server = serverOf(() => Response.json({ ok: true }));
    await api.frame.$get();
    await api.settings["sign-everyone-out"].$post({ json: {} });
    const sent = server.mock.calls.map(([input, init]) => new Request(new URL(String(input), window.location.href), init));

    expect(sent.map((request) => [request.method, new URL(request.url).pathname, request.headers.get("X-Requested-With")])).toEqual([
      ["GET", `${BOOT.base}/data/frame`, "XMLHttpRequest"],
      ["POST", `${BOOT.base}/data/settings/sign-everyone-out`, "XMLHttpRequest"],
    ]);
  });
});

describe("a login that ended", () => {
  // Drift: the page would stay, drawing a failure nobody can act on, where one reload leads through the provider's login and back.
  test("loads a page with nothing unsaved again, and leaves no line", async () => {
    using _server = serverOf(providersRefusal);
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    const refusal = await refusalOf(api.frame.$get());

    expect([refusal, reload.mock.calls.length, toast.getToasts().length]).toEqual([["logged_out", LOG_IN_AGAIN], 1, 0]);
  });

  // Drift: a reload would drop what a person typed and had not saved, or ask them to leave it, when the login can be had in another tab and the form sent again.
  test("leaves a page that holds unsaved typing as it is, with one line whose button opens the dashboard in a new tab, however many calls were refused", async () => {
    using _server = serverOf(providersRefusal);
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    using opened = spyOn(window, "open").mockImplementation(() => null);
    const saved = holdUnsaved();
    const refusals = [await refusalOf(api.settings["sign-everyone-out"].$post({ json: {} })), await refusalOf(api.frame.$get())];
    saved();
    const lines = toast.getToasts() as readonly { readonly title?: unknown; readonly action?: { readonly label?: unknown; readonly onClick?: (event: never) => void } }[];
    lines[0]?.action?.onClick?.(undefined as never);

    expect([refusals, reload.mock.calls.length]).toEqual([[["logged_out", LOG_IN_AGAIN], ["logged_out", LOG_IN_AGAIN]], 0]);
    expect(lines.map((line) => [line.title, line.action?.label])).toEqual([[LOG_IN_AGAIN, "Log in again"]]);
    expect(opened.mock.calls).toEqual([[`${BOOT.base}/`, "_blank", "noopener"]]);
  });

  // Drift: any other refusal would be taken for a login that ended: a removed user's page would load without end, and a refused change would lose its sentence.
  test.each([
    [403, { ok: false, code: "not_a_user", about: null, sentence: "This email is not a user of this install." }, ["not_a_user", "This email is not a user of this install."]],
    [503, { ok: false, code: "login_unchecked", about: null, sentence: "The login cannot be checked right now. Try again." }, ["login_unchecked", "The login cannot be checked right now. Try again."]],
    [400, { ok: false, code: "bad_argument", about: "name", sentence: "That name is taken." }, ["bad_argument", "That name is taken."]],
  ] as const)("is not what a %d is: the refusal is told in the server's own sentence, and the page stays", async (status, body, told) => {
    using _server = serverOf(() => Response.json(body, { status }));
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);

    expect<unknown>([await refusalOf(api.frame.$get()), reload.mock.calls.length, toast.getToasts().length]).toEqual([told, 0, 0]);
  });
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

  // Drift: the graph's reads would be kept under another key than the one that gives them thirty minutes, and every look at the window would walk its rows again.
  test.each([
    ["29 minutes 59 seconds on", 1799 * SECOND, 1],
    ["30 minutes 1 second on", 1801 * SECOND, 2],
  ] as const)("of the visits graph's days stands thirty minutes: %s", async (_what, later, asks) => {
    using answering = server(200);
    const read = Date.UTC(2026, 10, 16, 12);
    setSystemTime(new Date(read));
    const first = renderHook(() => useVisits(CHOICE), { wrapper: inQueries });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    // The screen is left for that long: the clock that drops what no screen shows runs on too.
    jest.useFakeTimers();
    try {
      first.unmount();
      jest.advanceTimersByTime(later);
    } finally {
      jest.useRealTimers();
    }
    // The real timers bring the real clock back with them: the moment the screen is come back to is set anew.
    setSystemTime(new Date(read + later));
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
