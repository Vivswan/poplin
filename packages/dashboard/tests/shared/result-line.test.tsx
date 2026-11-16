// The line a list says to a screen reader: what it keeps while another list is read.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { ResultLine } from "@/shared/result-line";

afterEach(cleanup);
afterAll(clearPage);

describe("the line a list says", () => {
  // Drift: the line would go empty while the next list is read and be said twice, once empty; or it would keep the old words once the new ones are there.
  test("keeps what it said while the next list is read, and says the next once it is there", () => {
    const drawn = render(<ResultLine words="12 sites" />);
    const said = (): string | undefined => drawn.getByRole("status").textContent;
    const first = said();
    drawn.rerender(<ResultLine words={undefined} />);
    const meanwhile = said();
    drawn.rerender(<ResultLine words="2 sites" />);

    expect([first, meanwhile, said()]).toEqual(["12 sites", "12 sites", "2 sites"]);
  });
});
