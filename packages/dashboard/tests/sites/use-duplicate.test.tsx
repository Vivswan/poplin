// A copy of a site from the dashboard: what the dialog sends, what the background work asks after it, and the line each ending is said in.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BOOT } from "@/lib/boot";
import type { Site } from "@/lib/sites";
import { DuplicateDialog } from "@/sites/duplicate-dialog";
import { SITES_KEY } from "@/sites/site-queries";

import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The site that is copied. */
const SOURCE = {
  id: "abc123def456",
  label: "trip-notes--abc123def456",
  name: "trip-notes",
  public_name: null,
  title: "Trip notes",
  title_typed: true,
  access: "unlisted",
  url: "https://example.com/trip-notes/",
  addresses: { site: "https://example.com/trip-notes/", public: null },
  search_engines: false,
  embeddable: false,
  expires: null,
  versions: [{ number: 1, published: 1_700_000_000_000, published_by: "mira@example.com" }],
  live_version: 1,
  bytes: 2048,
  files: 40,
  updated: 1_700_000_000_000,
  state: "live",
  views: { today: 0, week: 0 },
} as unknown as Site;

/** The copy once it is a site. */
const COPY = { ...SOURCE, id: "zyx987wvu654", label: "trip-notes--zyx987wvu654", access: "private" };

/** The upload the copy's answers name. */
const UPLOAD = "00000000000000aa";

/** A request that copied files and left some: the copy is no site yet. */
function partly(copied: number): Response {
  return Response.json({ ok: true, site: null, copy: { upload: UPLOAD, copied, files: 40 } });
}

/** A request that only asked after the copy, of an install that copies by itself: it counts no file. */
function watched(): Response {
  return Response.json({ ok: true, site: null, copy: { upload: UPLOAD, copied: null, files: 40 } });
}

/** The request that copied the last file. */
function whole(): Response {
  return Response.json({ ok: true, site: COPY, copy: { upload: UPLOAD, copied: 40, files: 40 } });
}

function refusal(status: number, code: string, about: string | null, sentence: string): Response {
  return Response.json({ ok: false, code, about, sentence }, { status });
}

/** Every change the client sent, as its path under the data routes and its body. */
const sent: string[] = [];

/** How often the list of sites was read. */
const reads = { list: 0 };

/** The requests of a copy that wait for the test to let their answer go. */
const held: (() => void)[] = [];

/**
 * Answer the client's requests: each request of a copy with the next of `rounds`, and each cancel with `cancelled`.
 *
 * @param holdFrom - the request of a copy, counted from 0, from which each waits until the test lets it go
 */
function serve(rounds: readonly (() => Response)[], cancelled: () => Response = () => Response.json({ ok: true, left: [] }), holdFrom = 1): void {
  let round = 0;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : input, window.location.href).pathname.slice(`${BOOT.base}/data`.length);
    if (path === "/sites") {
      reads.list += 1;

      return Response.json({ ok: true, sites: [], next: null, logins: {} });
    }

    sent.push(`${path} ${String(init?.body)}`);
    if (path.endsWith("/cancel")) return cancelled();

    const answer = rounds[round];
    round += 1;
    if (round > holdFrom) await new Promise<void>((resolve) => held.push(resolve));

    return answer?.() ?? refusal(500, "failed", null, "No answer was set.");
  }) as typeof fetch;
}

/** A screen that asks for the copy: the button that opens the dialog, and a read of the sites as a table makes it. `left` draws it without the dialog, as another screen. */
function Screen(): ReactNode {
  const [site, setSite] = useState<Site>();
  const [left, setLeft] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useQuery({ queryKey: [...SITES_KEY, "page"], queryFn: async () => (await fetch(`${BOOT.base}/data/sites`)).json() });

  return (
    <>
      <button ref={opener} type="button" onClick={() => setSite(SOURCE)}>
        Ask
      </button>
      <button type="button" onClick={() => setLeft(true)}>
        Leave
      </button>
      {left ? null : <DuplicateDialog site={site} onClose={() => setSite(undefined)} returnTo={opener} />}
    </>
  );
}

/** Press something of the page, and let the screen take what follows in. */
async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(target);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Let the oldest waiting request of a copy be answered. */
async function letGo(): Promise<void> {
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  await act(async () => {
    held.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every line that is shown and not on its way out, as its words and then the words of its button. */
function lines(): readonly string[] {
  return [...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')].map((line) => [line.querySelector("[data-title]")?.textContent, line.querySelector("button")?.textContent ?? ""].join("|"));
}

/** Draw the screen, open the dialog, and press Duplicate with `name` typed, or with the name the dialog opened with. */
async function duplicate(name?: string): Promise<{ readonly page: Within; readonly router: AnyRouter }> {
  const router = await drawAt(
    "/",
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider storageKey="test.theme">
        <Screen />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const page = within(document.body);
  await press(page.getByRole("button", { name: "Ask" }));
  if (name !== undefined) fireEvent.change(page.getByRole("textbox", { name: "Name" }), { target: { value: name } });

  await press(page.getByRole("button", { name: "Duplicate" }));

  return { page, router };
}

/** Whether the dialog is shown. */
function asks(page: Within): boolean {
  return page.queryByRole("dialog") !== null;
}

afterEach(() => {
  // A line said in one test would still be drawn in the next.
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN_FETCH;
  sent.length = 0;
  held.length = 0;
  reads.list = 0;
});
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("the dialog", () => {
  // Drift: a copy of a small site would show a line that it is on its way, for work that is done already; or the copy would be made with no way to it.
  test("of a site copied by one request says it is duplicated at once, with the way to the copy's panel, and reads the list again", async () => {
    serve([whole]);
    const { page, router } = await duplicate();
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|Open"]));

    const read = reads.list;
    await press(page.getByRole("button", { name: "Open" }));

    expect([sent, asks(page), read, router.state.location.pathname]).toEqual([[`/sites/${SOURCE.id}/duplicate {"name":"trip-notes"}`], false, 2, `/sites/${COPY.label}`]);
  });

  // Drift: a refused name would close the dialog, and the person would type the whole name again; or the refusal would be a line far from the field.
  test("keeps a refused name in its field with the refusal under it, and says no line", async () => {
    serve([() => refusal(400, "bad_name", "name", "The name breaks the rules.")]);
    const { page } = await duplicate("Trip Notes 2");
    await waitFor(() => expect(page.queryByText("The name breaks the rules.") !== null).toBe(true));

    expect([(page.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value, asks(page), lines()]).toEqual(["Trip Notes 2", true, []]);
  });

  // Drift: a refusal that is not about the name would be shown at the name's field, where nothing typed can mend it.
  test("closes on a refusal that is not about the name, which is said in a line", async () => {
    serve([() => refusal(409, "too_many_sites", "max_sites", "The install holds as many sites as it may, so no copy was made.")]);
    const { page } = await duplicate();
    await waitFor(() => expect(lines()).toEqual(["The install holds as many sites as it may, so no copy was made.|"]));

    expect(asks(page)).toBe(false);
  });
});

describe("a question left while its first request is on its way", () => {
  // Drift: the answer of a question that was left would close whatever question is open by then, and a person's typing in it would be gone.
  test("leaves the question asked after it open when its answer comes, and the copy is said as done", async () => {
    serve([whole], undefined, 0);
    const { page } = await duplicate();
    await press(page.getByRole("button", { name: "Cancel" }));
    await press(page.getByRole("button", { name: "Ask" }));
    await letGo();
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|Open"]));

    expect(asks(page)).toBe(true);
  });

  // Drift: the refusal of a name typed into a question that was left would be shown at the field of the next question, over a name nobody refused.
  test("shows the refusal of its name at no later question", async () => {
    serve([() => refusal(400, "bad_name", "name", "The name breaks the rules.")], undefined, 0);
    const { page } = await duplicate("Trip Notes 2");
    await press(page.getByRole("button", { name: "Cancel" }));
    await press(page.getByRole("button", { name: "Ask" }));
    await letGo();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect([asks(page), page.queryByText("The name breaks the rules."), (page.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value]).toEqual([true, null, "trip-notes"]);
  });
});

describe("a copy that takes more requests", () => {
  // Drift: the copy would stop when the person leaves the Sites screen, and a third of a site would wait a day for the sweep; or its end would be said to nobody.
  test("goes on after the screen that began it is left, one request after another, and says it is duplicated when the last is answered", async () => {
    serve([() => partly(15), () => partly(30), whole]);
    const { page } = await duplicate();
    await waitFor(() => expect(lines()).toEqual(["Duplicating. Ready in a few seconds.|Cancel"]));
    await press(page.getByRole("button", { name: "Leave" }));
    await letGo();
    await letGo();
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|Open"]));

    expect(sent).toEqual([`/sites/${SOURCE.id}/duplicate {"name":"trip-notes"}`, `/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`, `/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`]);
  });

  // Drift: Cancel would stop the requests alone, and the files copied so far would stay in the store until the sweep.
  test("is given up at Cancel once the request on its way is answered, and no request of the copy follows", async () => {
    serve([() => partly(15), () => partly(30), whole]);
    const { page } = await duplicate();
    await waitFor(() => expect(lines()).toEqual(["Duplicating. Ready in a few seconds.|Cancel"]));
    await press(page.getByRole("button", { name: "Cancel" }));
    await letGo();
    await waitFor(() => expect(lines()).toEqual(["Cancelled. No copy was made.|"]));

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`]);
  });

  // Drift: a refusal in the middle would leave the line that the copy is on its way for good, and its files in the store.
  test("that is refused in the middle is given up, and the refusal is said in a line", async () => {
    serve([() => partly(15), () => refusal(409, "no_such_version", null, "That version is not kept.")], () => refusal(404, "not_found", "upload", "That copy is gone."));
    await duplicate();
    await letGo();
    await waitFor(() => expect(lines()).toEqual(["That version is not kept.|"]));

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`]);
  });

  // Drift: a copy finished by a request whose answer was lost would be said as failed, and the person would make it a second time.
  test("whose cancel finds it finished is asked for once more, and said as duplicated", async () => {
    serve([() => partly(15), () => refusal(500, "failed", null, "Something went wrong."), whole], () => refusal(409, "upload_finished", "upload", "The copy is finished already."), 3);
    await duplicate();
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|Open"]));

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`, `/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`]);
  });

  // Drift: a copy the server says is finished would be said as failed when its answer cannot be read a second time, though the list shows it.
  test("whose cancel finds it finished is said as duplicated also when its answer is lost again, with no way named to a site nobody answered", async () => {
    serve([() => partly(15), () => refusal(500, "failed", null, "Something went wrong."), () => refusal(500, "failed", null, "Something went wrong.")], () => refusal(409, "upload_finished", "upload", "The copy is finished already."), 3);
    await duplicate();
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|"]));

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`, `/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`]);
  });

  // Drift: an install that copies by itself answers no count; read as a copy that did not move on, it would be given up while its job runs, and asked after with no pause it would send a request as fast as the last is answered.
  test("that the install makes by itself is asked after with a pause between two asks, is not given up while no file is counted, and is said as duplicated once an ask answers the site", async () => {
    serve([() => partly(15), watched, whole], undefined, 3);
    await duplicate();
    await waitFor(() => expect(sent.length).toBe(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)));
    const meanwhile = [sent.length, lines()];
    await waitFor(() => expect(lines()).toEqual(["Duplicated.|Open"]), { timeout: 4000 });

    expect([meanwhile, sent.slice(1)]).toEqual([[2, ["Duplicating. Ready in a few seconds.|Cancel"]], [`/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`, `/sites/${SOURCE.id}/duplicate {"upload":"${UPLOAD}"}`]]);
  }, 10_000);

  // Drift: Cancel pressed during the pause would wait the pause out, or the copy would be given up in the page alone while the install goes on making it.
  test("that the install makes by itself is given up at Cancel without the pause being waited out", async () => {
    serve([() => partly(15), watched, whole], undefined, 3);
    const { page } = await duplicate();
    await waitFor(() => expect(sent.length).toBe(2));
    await press(page.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(lines()).toEqual(["Cancelled. No copy was made.|"]), { timeout: 1000 });

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`]);
  });

  // Drift: a request that copies nothing more would be sent again for ever, a request a second, with a line that never leaves.
  test("that a request did not move on is given up, and said as stopped", async () => {
    serve([() => partly(15), () => partly(15)], undefined, 3);
    await duplicate();
    await waitFor(() => expect(lines()).toEqual(["The copy stopped. Duplicate the site again.|"]));

    expect(sent.slice(2)).toEqual([`/copies/${UPLOAD}/cancel {}`]);
  });
});
