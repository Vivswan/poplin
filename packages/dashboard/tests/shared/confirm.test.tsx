// A question is answered once for each asking, whatever is pressed while it fades.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { Confirm } from "@/shared/confirm";

/** A question that is asked by a button and closed by its answer, as every screen asks one. */
function Asked({ answers }: { readonly answers: boolean[] }): ReactNode {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setAsking(true)}>
        Ask
      </button>
      <Confirm
        question={asking ? { title: "Sign everyone out?", says: "Every login ends.", yes: "Sign everyone out" } : undefined}
        onAnswer={(yes) => {
          answers.push(yes);
          setAsking(false);
        }}
      />
    </>
  );
}

afterEach(cleanup);
afterAll(clearPage);

describe("the answer to a question", () => {
  // Drift: the button that does it is still drawn while the question fades, and the second press of a double click would do the change again; a Cancel pressed then would answer a question that is already answered.
  test("is given once for an asking: a second press on the button and a Cancel after it answer nothing, and the next asking is answered again", async () => {
    const answers: boolean[] = [];
    render(<Asked answers={answers} />);
    act(() => screen.getByRole("button", { name: "Ask" }).click());
    const yes = await screen.findByRole("button", { name: "Sign everyone out" });
    const no = screen.getByRole("button", { name: "Cancel" });
    act(() => yes.click());
    act(() => yes.click());
    act(() => no.click());
    const first = [...answers];

    act(() => screen.getByRole("button", { name: "Ask", hidden: true }).click());
    act(() => screen.getAllByRole("button", { name: "Cancel" }).at(-1)?.click());

    expect([first, answers]).toEqual([[true], [true, false]]);
  });
});
