// The dialog that changes how a site is named, where the source cannot say it alone: what an opening starts from after one that was left, and what a site read again leaves of what is typed.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { Site } from "@/lib/sites";
import { EditSiteDialog } from "@/sites/edit-site-dialog";

/** The site the dialog is opened for. */
const SITE = {
  id: "abc123def456",
  label: "trip-notes--abc123def456",
  name: "trip-notes",
  public_name: null,
  title: "Trip notes",
  title_typed: true,
  access: "private",
} as unknown as Site;

/** What a person types and then leaves. */
const DRAFT = { title: "Draft X", name: "ab" } as const;

/** The dialog over a site, or closed. */
function Editing({ site }: { readonly site: Site | undefined }): ReactNode {
  return <EditSiteDialog site={site} onClose={() => undefined} onSave={async () => undefined} />;
}

/** What the two fields hold, and whether Save is on. */
function held(): readonly [title: string, name: string, save: boolean] {
  const [title, name] = ["Title", "Name"].map((label) => (screen.getByRole("textbox", { name: label }) as HTMLInputElement).value);

  return [title ?? "", name ?? "", !screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")];
}

afterEach(cleanup);

afterAll(clearPage);

describe("the dialog that edits a site", () => {
  // Drift: the dialog is kept while it is closed, so what was typed and left by Cancel would be there at the next opening for the same site, with Save lit over a change nobody means.
  test("opened again for the same site after it was left starts from what the site holds", async () => {
    const { rerender } = render(<Editing site={SITE} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: DRAFT.title } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: DRAFT.name } });
    const typed = held();
    rerender(<Editing site={undefined} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<Editing site={SITE} />);

    expect([typed, held()]).toEqual([
      [DRAFT.title, DRAFT.name, true],
      ["Trip notes", "trip-notes", false],
    ]);
  });

  // Drift: the lists are read again in the background, which hands the open dialog the same site as a new object. Taken for an opening, that read would wipe what a person is typing.
  test("the same site read again while the dialog is open keeps what was typed, and a field left alone is still not sent", async () => {
    const sent: unknown[] = [];
    const editing = (site: Site): ReactNode => <EditSiteDialog site={site} onClose={() => undefined} onSave={async (_site, changes) => void sent.push(changes)} />;
    const { rerender } = render(editing(SITE));
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: DRAFT.title } });
    rerender(editing({ ...SITE, name: "renamed-elsewhere" } as unknown as Site));
    const after = held();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect([after, sent]).toEqual([[DRAFT.title, "trip-notes", true], [{ title: DRAFT.title }]]);
  });

  // Drift: with the name emptied, Save is off and Enter does nothing, and a dialog that says nothing of it leaves a person pressing a dead button. A name of two letters is told its rule by the server; an empty one never gets that far.
  test("an emptied Name says under the field that a site needs one, with Save off, and the hint is back once a letter is typed", () => {
    render(<Editing site={SITE} />);
    const name = screen.getByRole("textbox", { name: "Name" });
    const says = (): readonly [needed: number, hint: number, save: boolean] => [screen.queryAllByText("A site needs a name.").length, screen.queryAllByText("The link uses this name. Old links keep working.").length, held()[2]];
    const before = says();
    fireEvent.change(name, { target: { value: "  " } });
    const emptied = says();
    fireEvent.change(name, { target: { value: "t" } });

    expect([before, emptied, says()]).toEqual([
      [0, 1, false],
      [1, 0, false],
      [0, 1, true],
    ]);
  });
});
