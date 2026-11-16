// A question with one field: the field says that it must be filled, and is marked as refused only by a refusal.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AskDialog } from "@/shared/ask-dialog";

afterEach(cleanup);
afterAll(clearPage);

describe("the field of a question", () => {
  // Drift: the UI library's own check of a field that must be filled would mark an emptied field as refused at Enter, with no refusal shown: a screen reader would say "invalid" and nothing tells why.
  test("says it must be filled, and is not marked as refused when it is emptied and Enter is pressed", () => {
    render(<AskDialog open onOpenChange={() => undefined} title="New link" says="Makes a link." label="Name" hint="Letters and digits." initial="" submit="Add" onSubmit={async () => undefined} />);
    const field = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(field, { target: { value: "one" } });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect([field.getAttribute("aria-required"), field.getAttribute("aria-invalid"), screen.queryAllByRole("alert").length]).toEqual(["true", null, 0]);
  });
});
