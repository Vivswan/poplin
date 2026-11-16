// The strip of a screen's tabs: which tab it marks, and what it tells the screen of a press.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

import { type ScreenTab, ScreenTabs } from "@/shared/screen-tabs";

/** The tabs of the test strip. */
const TABS: readonly ScreenTab<"first" | "shown" | "last">[] = [
  { id: "first", label: "First" },
  { id: "shown", label: "Shown" },
  { id: "last", label: "Last" },
];

/** Every tab the strip told the screen of. */
const chosen: string[] = [];

function strip(): Within {
  render(<ScreenTabs label="Kinds of things" tabs={TABS} active="shown" onChoose={(id) => chosen.push(id)} />);

  return within(within(document.body).getByRole("tablist", { name: "Kinds of things" }));
}

afterEach(() => {
  cleanup();
  chosen.length = 0;
});

afterAll(clearPage);

describe("the strip of a screen's tabs", () => {
  // Drift: the strip would mark a tab of its own choosing, not the one the screen draws.
  test("it marks the tab the screen names, and no other", () => {
    const tabs = strip().getAllByRole("tab");

    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  // Drift: a press would change nothing, since the strip keeps no tab of its own.
  test("a press tells the screen the id of the tab", () => {
    fireEvent.click(strip().getByRole("tab", { name: "First" }));

    expect(chosen).toEqual(["first"]);
  });
});
