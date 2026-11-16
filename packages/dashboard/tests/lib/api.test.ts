// The client of the data routes: what every call says of itself, and what a login that ended does to the page.

import { afterEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { toast } from "sonner";

import { answerOf, api, Refused } from "@/lib/api";
import { BOOT } from "@/lib/boot";

/** The line a login that ended leaves on a page that holds unsaved typing. */
const LOG_IN_AGAIN = "Your login ended. Log in again in a new tab, then try again here.";

/** The provider's own answer to a script's call whose login ended: a page, and no JSON. */
function providersRefusal(): Response {
  return new Response("<html><body>Unauthorized</body></html>", { status: 401, headers: { "Content-Type": "text/html" } });
}

/** Answer every call of the client with what `answer` makes, and keep the calls. */
function serverOf(answer: () => Response): Mock<typeof fetch> {
  return spyOn(globalThis, "fetch").mockImplementation((async () => answer()) as unknown as typeof fetch);
}

/** Ask one data route and say what the call was refused as. */
async function refusalOf(asked: Promise<Parameters<typeof answerOf>[0]>): Promise<readonly [code: string, sentence: string] | "answered"> {
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

afterEach(() => {
  for (const shown of toast.getToasts()) toast.dismiss(shown.id);
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
