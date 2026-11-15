// What a table keeps of its measuring from page to page of one list: the column edges hold, and move only for a wider value.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { useFitted } from "@/table/measure";

/** The page's own reading of an element's box, put back after the tests. */
const OWN_BOX = HTMLElement.prototype.getBoundingClientRect;

/** A table of one heading per column, each as wide as the test says, with the widths it measured written under it. */
function Probe({ widths, list }: { readonly widths: Readonly<Record<string, number>>; readonly list?: string }): ReactNode {
  const [table, fitted] = useFitted([widths], list);

  return (
    <>
      <table ref={table}>
        <thead>
          <tr>
            {Object.entries(widths).map(([id, width]) => (
              <th key={id} data-column={id} data-width={width} />
            ))}
          </tr>
        </thead>
      </table>
      <output>{JSON.stringify(Object.fromEntries(fitted.needs))}</output>
    </>
  );
}

/** The widths the table measured, as the probe wrote them. */
function measured(): unknown {
  return JSON.parse(document.querySelector("output")?.textContent ?? "null");
}

beforeAll(() => {
  // The test page lays nothing out: a heading is as wide as its `data-width` says.
  HTMLElement.prototype.getBoundingClientRect = function box(this: HTMLElement): DOMRect {
    return { width: Number(this.dataset.width ?? 0) } as DOMRect;
  };
});

afterEach(cleanup);

afterAll(async () => {
  HTMLElement.prototype.getBoundingClientRect = OWN_BOX;
  await clearPage();
});

describe("the widths a table measures", () => {
  // Drift: every page of a list would be fitted alone, so a column's edge would stand at another place on each page; or a list narrowed anew would keep the widths of the list before it.
  test.each([
    ["the next page of the same list holds only narrower values", ["newest", { when: 122, site: 80 }], ["newest", { when: 118, site: 60 }], { when: 122, site: 80 }],
    ["the next page of the same list holds a wider value", ["newest", { when: 122, site: 60 }], ["newest", { when: 118, site: 80 }], { when: 122, site: 80 }],
    ["the rows are those of another list", ["newest", { when: 122, site: 80 }], ["oldest", { when: 118, site: 60 }], { when: 118, site: 60 }],
    ["the table names no list", [undefined, { when: 122, site: 80 }], [undefined, { when: 118, site: 60 }], { when: 118, site: 60 }],
  ] as const)("are kept at their widest while %s", (_what, [first, before], [second, after], kept) => {
    const { rerender } = render(<Probe widths={before} list={first} />);
    rerender(<Probe widths={after} list={second} />);

    expect(measured()).toEqual(kept);
  });
});
