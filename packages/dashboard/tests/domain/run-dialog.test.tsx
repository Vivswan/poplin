// The dialog of a run: the box that holds a token only until its run is sent, where a refusal is said, and when the dialog may close.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Dialog as DialogParts } from "@base-ui/react/dialog";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

import { DialogTrigger } from "@/components/ui/dialog";
import { RunDialog } from "@/domain/run-dialog";
import type { Sent } from "@/domain/token-run";
import { Refused } from "@/lib/api";

/** What a token must hold, in an invented provider's words. */
const FORM = {
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [],
  tokenNote: "Choose what the account token is for.",
};

/** The token the tests paste. */
const TOKEN = "planted-token-0123456789";

/** What the dialog was asked to run. */
const runs: { run: string; sent: Sent }[] = [];

/** The hold of the dialog under test, by which a caller closes it. */
const handle = DialogParts.createHandle<"check" | "repair">();

/** Draw a button that opens the dialog with one run, over an answer; open it, and hand back the page's queries once the dialog holds the focus. */
async function opened(run: "check" | "repair", answer: () => Promise<Refused | undefined>): Promise<ReturnType<typeof within>> {
  const onRun = (kind: "check" | "repair", sent: Sent): Promise<Refused | undefined> => {
    runs.push({ run: kind, sent });

    return answer();
  };
  render(
    <>
      <DialogTrigger handle={handle} payload={run}>
        Open
      </DialogTrigger>
      <RunDialog handle={handle} form={FORM} onRun={onRun} />
    </>,
  );
  const page = within(document.body);
  fireEvent.click(page.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(page.getByRole("dialog").contains(document.activeElement)).toBe(true));

  return page;
}

function tokenBox(page: ReturnType<typeof within>): HTMLInputElement {
  return page.getByLabelText("Account token") as HTMLInputElement;
}

async function press(page: ReturnType<typeof within>, name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(page.getByRole("button", { name }));
  });
}

afterEach(() => {
  cleanup();
  runs.length = 0;
});
afterAll(clearPage);

describe("the token's box", () => {
  // Drift: the token would show as typed, be offered by the browser again, or stay in the page after its run, where a glance or a later script finds it.
  test.each([
    ["a run that read its pieces", undefined],
    ["a refused token", new Refused({ code: "token", about: "token", sentence: "Account token refused: paste the whole account token, made for this account and this domain." })],
    ["a provider that did not answer", new Refused({ code: "unreachable", about: null, sentence: "No answer from the provider. Try again." })],
  ])("is a password box the browser does not fill, sent once and emptied after %s", async (_name, refusal) => {
    const page = await opened("check", async () => refusal);
    const token = tokenBox(page);
    fireEvent.change(token, { target: { value: TOKEN } });
    await press(page, "Check");

    expect([token.type, token.autocomplete, token.required]).toEqual(["password", "off", true]);
    expect(runs).toEqual([{ run: "check", sent: { token: TOKEN } }]);
    expect([token.value, document.body.innerHTML.includes(TOKEN)]).toEqual(["", false]);
  });

  // Drift: an empty box would send a run, or be told by the browser's own bubble where every other refusal stands under its box.
  test("sends nothing while it is empty, and says so under it", async () => {
    const page = await opened("repair", async () => undefined);
    await press(page, "Repair");
    const token = tokenBox(page);

    expect([runs, (token.form as HTMLFormElement).noValidate]).toEqual([[], true]);
    expect([token.getAttribute("aria-invalid"), document.activeElement === token, token.closest('[data-slot="field"]')?.querySelector('[role="alert"]')?.textContent]).toEqual([
      "true",
      true,
      "Paste an account token first.",
    ]);
  });
});

describe("the dialog", () => {
  // Drift: the dialog opened by Check would repair, or Enter in the box would send the other run.
  test.each(["check", "repair"] as const)("sends a %s, the run its button opened it with, when its form is sent", async (run) => {
    const page = await opened(run, async () => undefined);
    fireEvent.change(tokenBox(page), { target: { value: TOKEN } });
    await act(async () => {
      fireEvent.submit(tokenBox(page).form as HTMLFormElement);
    });

    expect(runs).toEqual([{ run, sent: { token: TOKEN } }]);
  });

  // Drift: a refused token would be said away from its box, the box to correct would not hold the focus, or the dialog would close on a refusal.
  test("says a refused token at its box, which takes the focus, and stays open", async () => {
    const page = await opened("repair", async () => new Refused({ code: "token", about: "token", sentence: "Account token refused: paste the whole account token, made for this account and this domain." }));
    fireEvent.change(tokenBox(page), { target: { value: TOKEN } });
    await press(page, "Repair");
    const token = tokenBox(page);

    expect([token.getAttribute("aria-invalid"), document.activeElement === token]).toEqual(["true", true]);
    expect(token.closest('[data-slot="field"]')?.textContent).toContain("Account token refused: paste the whole account token, made for this account and this domain.");
  });

  // Drift: a refusal about no box, such as a provider that did not answer, would not be said at all.
  test("says a refusal about no box over its buttons", async () => {
    const page = await opened("check", async () => new Refused({ code: "unreachable", about: null, sentence: "No answer from the provider. Try again." }));
    fireEvent.change(tokenBox(page), { target: { value: TOKEN } });
    await press(page, "Check");

    expect(page.getByRole("alert").textContent).toBe("No answer from the provider. Try again.");
  });

  // Drift: the caller's close after a done run would be held back as a person's is, since the run still counts as on its way: the dialog stayed open over the new result.
  test("closes when its caller closes it at the end of a run", async () => {
    const page = await opened("repair", async () => handle.close());
    fireEvent.change(tokenBox(page), { target: { value: TOKEN } });
    await press(page, "Repair");

    await waitFor(() => expect(page.queryByRole("dialog") === null).toBe(true));
  });

  // Drift: Escape would take the dialog away while its run is on its way, so the result has nowhere to be said; or Cancel would not close it after.
  test("stays open at Escape while its run is on its way, and closes at Cancel after", async () => {
    let answer: (refusal: Refused) => void = () => undefined;
    const page = await opened("repair", () => new Promise((resolve) => (answer = resolve)));
    fireEvent.change(tokenBox(page), { target: { value: TOKEN } });
    await press(page, "Repair");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    const during = page.queryByRole("dialog") !== null;
    await act(async () => answer(new Refused({ code: "unreachable", about: null, sentence: "No answer from the provider. Try again." })));
    await press(page, "Cancel");

    expect(during).toBe(true);
    await waitFor(() => expect(page.queryByRole("dialog") === null).toBe(true));
  });
});
