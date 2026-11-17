// A dialog closes when the address leaves the place it was opened at.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { drawAt } from "../lib/support/router";

/** A dialog a screen opens and holds open, and a question that opens itself by the library's trigger: the two ways a dialog of the console is opened. */
function Both({ closed }: { readonly closed: string[] }): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closed.push("held");

          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle>Edit the site</DialogTitle>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete for good?</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The titles of the dialogs that are open. */
function open(): readonly string[] {
  return screen.queryAllByRole("heading").map((title) => title.textContent ?? "");
}

afterEach(cleanup);
afterAll(clearPage);

describe("a dialog and the address", () => {
  // Drift: the browser's Back closed a site's panel and left its dialog over the list, where its button still changed the site.
  test.each([
    ["a dialog its screen holds open", "Edit", "Edit the site"],
    ["a question that opens itself", "Delete", "Delete for good?"],
  ] as const)("%s closes when the path changes, and stays when only the query does", async (_kind, opener, title) => {
    const closed: string[] = [];
    const router = await drawAt("/sites/one", <Both closed={closed} />);
    act(() => screen.getByRole("button", { name: opener }).click());
    await waitFor(() => expect(open()).toEqual([title]));

    await act(async () => router.navigate({ to: "/sites/one", search: { q: "a" } }));
    const afterQuery = open();
    await act(async () => router.navigate({ to: "/" }));
    await waitFor(() => expect(open()).toEqual([]));

    expect([afterQuery, closed]).toEqual([[title], opener === "Edit" ? ["held"] : []]);
  });

  // Drift: a site renamed in another tab moves its panel to the new label, and the Edit open over it would close with what was typed in it.
  test("a dialog stays open through a move that replaces the address, and closes at the next move away from the new one", async () => {
    const router = await drawAt("/sites/one", <Both closed={[]} />);
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    await waitFor(() => expect(open()).toEqual(["Edit the site"]));
    await act(async () => router.navigate({ to: "/sites/renamed", replace: true }));
    const afterReplace = open();
    await act(async () => router.navigate({ to: "/" }));
    await waitFor(() => expect(open()).toEqual([]));

    expect(afterReplace).toEqual(["Edit the site"]);
  });

  // Drift: a dialog opened after a move would be closed by what the router still says of that move.
  test("a dialog opened after a move stays open through a change of the query", async () => {
    const router = await drawAt("/sites/one", <Both closed={[]} />);
    await act(async () => router.navigate({ to: "/sites/two" }));
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    await waitFor(() => expect(open()).toEqual(["Edit the site"]));
    await act(async () => router.navigate({ to: "/sites/two", search: { q: "b" } }));

    expect(open()).toEqual(["Edit the site"]);
  });
});
