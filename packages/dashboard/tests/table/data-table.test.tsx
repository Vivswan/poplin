// The shared table: what its headings say about order, which columns it draws in which order, what it keeps of a layout, and that a table with none has nothing to arrange.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { type ColumnSpec, DataTable, type Sort } from "@/table/data-table";
import { type TableLayout, useTableLayout } from "@/table/layout";
import { clearPage, type Within } from "../lib/support/page";

/** A row of the test table. */
interface Fruit {
  readonly name: string;
  readonly colour: string;
  readonly weight: number;
}

/** The test table's columns: the first fixed, the last hidden until chosen. */
const COLUMNS: readonly ColumnSpec<Fruit>[] = [
  { id: "name", header: "Name", sortable: "asc", fixed: true, cell: (fruit) => fruit.name },
  { id: "colour", header: "Colour", sortable: "desc", cell: (fruit) => fruit.colour },
  { id: "weight", header: "Weight", numeric: true, cell: (fruit) => `${fruit.weight} g` },
  { id: "origin", header: "Origin", hidden: true, cell: () => "Somewhere" },
];

/** The rows of the test table. */
const ROWS: readonly Fruit[] = [
  { name: "apple", colour: "red", weight: 150 },
  { name: "banana", colour: "yellow", weight: 120 },
];

/** The columns of a second table, shown in the first one's place. */
const OTHER_COLUMNS: readonly ColumnSpec<Fruit>[] = [
  { id: "name", header: "Name", fixed: true, cell: (fruit) => fruit.name },
  { id: "weight", header: "Weight", cell: (fruit) => `${fruit.weight} g` },
];

/** The order of the test table when nobody sorted it. */
const UNSORTED: Sort = { key: "name", descending: false };

/** The key the test table's layout is kept under. */
const KEPT_UNDER = "poplin.table.fruit";

/** What the test last saw of the layout, and of the table's asks. */
const seen: { layout?: TableLayout; sorted: (Sort | undefined)[]; opened: string[] } = { sorted: [], opened: [] };

/** The test table, which orders its rows as it is asked to, as a screen does through its address. With `plain` it is given no layout, as every table but the one of the sites. */
function Harness({
  sort: first = UNSORTED,
  other = false,
  plain = false,
  selected,
}: {
  readonly sort?: Sort;
  readonly other?: boolean;
  readonly plain?: boolean;
  readonly selected?: string;
}): ReactNode {
  const [sort, setSort] = useState(first);
  const columns = other ? OTHER_COLUMNS : COLUMNS;
  const layout = useTableLayout(other ? "other" : "fruit", columns);
  seen.layout = layout;

  return (
    <DataTable
      label="Fruit"
      columns={columns}
      rows={ROWS}
      rowId={(fruit) => fruit.name}
      layout={plain ? undefined : layout}
      sort={sort}
      selected={selected}
      onSort={(next) => {
        seen.sorted.push(next);
        setSort(next ?? UNSORTED);
      }}
      opens={{ name: (fruit) => `Details of ${fruit.name}`, open: (fruit) => seen.opened.push(fruit.name) }}
      actions={(fruit) => <button type="button">More for {fruit.name}</button>}
    />
  );
}

/** The page's own watcher of an element's size, put back after a test gave the table a room. */
const OWN_WATCHER = globalThis.ResizeObserver;

/** Give every table drawn from now on a room of this width, as a browser's layout would. */
function roomOf(width: number): void {
  globalThis.ResizeObserver = class {
    readonly #told: ResizeObserverCallback;

    constructor(told: ResizeObserverCallback) {
      this.#told = told;
    }

    observe(): void {
      this.#told([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }

    unobserve(): void {}

    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

/** The page's queries, bound when asked: the document exists only once the support module has run. */
function page(): Within {
  return within(document.body);
}

function headings(): string[] {
  return page()
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent?.trim() ?? "");
}

afterAll(clearPage);

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = OWN_WATCHER;
  seen.sorted = [];
  seen.opened = [];
});

describe("the table", () => {
  // Drift: a hidden column would be drawn, or the fixed column would not be first.
  test("draws the fixed column first, the others in order, and none that is hidden", () => {
    render(<Harness />);

    expect(headings()).toEqual(["Name", "Colour", "Weight", "Actions"]);
    expect(page().getAllByRole("row")[1]?.textContent).toBe("applered150 gMore for apple");
  });

  // Drift: a screen reader would be told nothing of the order, or the wrong column would be named as the sorted one.
  test("says the order on the heading the rows are sorted by, and on no heading the server cannot sort by", () => {
    render(<Harness sort={{ key: "colour", descending: true }} />);
    const sorts = page()
      .getAllByRole("columnheader")
      .map((heading) => heading.getAttribute("aria-sort"));

    expect(sorts).toEqual(["none", "descending", null, null]);
  });

  // Drift: a press on a heading would sort in the browser, over one page, and not ask the server; or three presses would not come round to the table's own order.
  test("asks for a column's first direction, then the other one, then no order, as its headings are pressed", () => {
    render(<Harness />);
    for (const heading of ["Colour", "Colour", "Colour", "Name", "Name"]) fireEvent.click(page().getByRole("button", { name: heading }));

    expect(seen.sorted).toEqual([
      { key: "colour", descending: true },
      { key: "colour", descending: false },
      undefined,
      { key: "name", descending: true },
      undefined,
    ]);
  });

  // Drift: a table too narrow for its columns would leave a chosen one out again, which the owner ruled out: it scrolls sideways.
  test("draws every chosen column however narrow its room", () => {
    roomOf(200);
    render(<Harness />);

    expect(headings()).toEqual(["Name", "Colour", "Weight", "Actions"]);
  });

  // Drift: a press on a row's own button would also open the row.
  test("opens a row on a press anywhere but on its own controls", () => {
    render(<Harness />);
    fireEvent.click(page().getByText("yellow"));
    fireEvent.click(page().getByRole("button", { name: "More for apple" }));

    expect(seen.opened).toEqual(["banana"]);
  });

  // Drift: a row would open at a press alone again, with no control a reader or a key finds; or the button's press would reach the row too and open it twice.
  test("starts each row that opens with a button named for the row, which opens it once", () => {
    render(<Harness />);
    fireEvent.click(page().getByRole("button", { name: "Details of apple" }));

    expect(seen.opened).toEqual(["apple"]);
  });

  // Drift: a heading's name would carry the names of its two tools again, and a screen reader would say all three at every cell.
  test("names each heading by its words alone, and the tools in it by their own", () => {
    render(<Harness />);
    // A name given as a string is matched whole, so a heading that also carried its tools' names would not be found.
    const found = ["Name", "Colour", "Weight", "Actions"].map((name) => page().getAllByRole("columnheader", { name }).length);

    expect(found).toEqual([1, 1, 1, 1]);
    expect(page().getByRole("button", { name: "Move the Colour column" })).toBeDefined();
    expect(page().getByRole("separator", { name: "Resize the Colour column" })).toBeDefined();
  });

  // Drift: the edge that resizes a column would be a bare button again: no value for a screen reader, or a value that is not the width drawn, and no key that puts the width back.
  test("resizes a column from its edge by the arrow keys down to the narrowest, says the width as the edge's value, and puts it back at Enter", () => {
    roomOf(600);
    render(<Harness />);
    const edge = (): HTMLElement => page().getByRole("separator", { name: "Resize the Colour column" });
    const said = (): (string | null)[] => ["aria-valuenow", "aria-valuemin", "aria-valuetext"].map((name) => edge().getAttribute(name));
    const first = said();

    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(seen.layout?.sizes).toEqual({ colour: 80 });
    expect(said()).toEqual(["80", "48", "80 pixels"]);

    for (let press = 0; press < 5; press += 1) fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(seen.layout?.sizes).toEqual({ colour: 48 });

    fireEvent.keyDown(edge(), { key: "Enter" });
    expect(seen.layout?.sizes).toEqual({});
    expect(said()).toEqual(first);
  });

  // Drift: a press on an edge would start a selection again: the drag marks the page's text, and the next press, which lands on marked text, drags that text in WebKit, so the edge hears one move and no release.
  test("takes a press on a column's edge for its own, with the edge in focus, and drags the column by it", () => {
    roomOf(600);
    render(<Harness />);
    const edge = (): HTMLElement => page().getByRole("separator", { name: "Resize the Colour column" });
    const from = Number(edge().getAttribute("aria-valuenow"));

    const untaken = fireEvent.mouseDown(edge(), { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 });
    fireEvent.mouseUp(document, { clientX: 140 });

    expect([untaken, document.activeElement === edge(), seen.layout?.sizes]).toEqual([false, true, { colour: from + 40 }]);
  });
});

describe("a table with no layout", () => {
  // Drift: a list nobody is meant to arrange would grow grips and edges again, or would draw a column that is hidden until chosen, with no menu to choose it; or its headings would stop sorting with them.
  test("has no grip and no edge at any heading, draws no hidden column, takes no kept layout, and still sorts by its headings", () => {
    window.localStorage.setItem(KEPT_UNDER, JSON.stringify({ order: ["name", "weight", "colour", "origin"], hidden: [], sizes: { colour: 300 } }));
    render(<Harness plain />);
    const tools = [page().queryAllByRole("button", { name: /^Move the / }).length, page().queryAllByRole("separator").length];
    fireEvent.click(page().getByRole("button", { name: "Colour" }));

    expect([tools, headings(), seen.sorted]).toEqual([[0, 0], ["Name", "Colour", "Weight", "Actions"], [{ key: "colour", descending: true }]]);
  });
});

describe("a table's layout", () => {
  // Drift: a chosen column, an order, or a width would be gone at the next visit.
  test("is kept in the browser at every change, and drawn from there", () => {
    render(<Harness />);
    act(() => seen.layout?.setHidden("origin", false));
    act(() => seen.layout?.setOrder(["name", "origin", "weight", "colour"]));
    act(() => seen.layout?.setSizes({ colour: 180 }));

    expect(headings()).toEqual(["Name", "Origin", "Weight", "Colour", "Actions"]);
    expect(JSON.parse(window.localStorage.getItem(KEPT_UNDER) ?? "")).toEqual({
      order: ["name", "origin", "weight", "colour"],
      hidden: [],
      sizes: { colour: 180 },
    });
  });

  // Drift: what an older version kept, or what someone typed into the browser's store, would hide the fixed column, move it, name a column that is gone, or show a new column nobody chose.
  test.each([
    [
      "the fixed column moved and hidden",
      { order: ["colour", "name", "weight", "origin"], hidden: ["name"], sizes: {} },
      ["Name", "Colour", "Weight", "Origin", "Actions"],
    ],
    [
      "a column that is gone, and two that are new, one of them hidden until chosen",
      { order: ["name", "gone", "weight"], hidden: ["gone"], sizes: { gone: 300 } },
      ["Name", "Weight", "Colour", "Actions"],
    ],
    ["no layout at all", "not a layout", ["Name", "Colour", "Weight", "Actions"]],
  ])("read from the browser with %s still holds", (_case, kept, expected) => {
    window.localStorage.setItem(KEPT_UNDER, JSON.stringify(kept));
    render(<Harness />);

    expect(headings()).toEqual(expected);
  });

  // Drift: a screen that swaps one table for another in place would draw the second in the first one's layout, and keep the first one's columns under the second one's key.
  test("is each table's own when one table takes another's place", () => {
    window.localStorage.setItem("poplin.table.other", JSON.stringify({ order: ["name", "weight"], hidden: [], sizes: { weight: 220 } }));
    const drawn = render(<Harness />);
    act(() => seen.layout?.setHidden("weight", true));
    drawn.rerender(<Harness other />);
    expect(headings()).toEqual(["Name", "Weight", "Actions"]);
    act(() => seen.layout?.setSizes({ weight: 240 }));

    expect(JSON.parse(window.localStorage.getItem("poplin.table.other") ?? "")).toEqual({ order: ["name", "weight"], hidden: [], sizes: { weight: 240 } });
    expect(JSON.parse(window.localStorage.getItem(KEPT_UNDER) ?? "").hidden).toEqual(["origin", "weight"]);
  });

  // Drift: Reset would leave a part of the arrangement behind.
  test("goes back to the start on reset", () => {
    render(<Harness />);
    act(() => seen.layout?.setHidden("colour", true));
    expect(seen.layout?.changed).toBe(true);
    act(() => seen.layout?.reset());

    expect(headings()).toEqual(["Name", "Colour", "Weight", "Actions"]);
    expect(seen.layout?.changed).toBe(false);
  });
});
