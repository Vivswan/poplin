// The foot of the Activity list: what it says of the page and the total, which ways it offers, and where each press leads.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { ActivityFoot } from "@/activity/activity-foot";
import type { Page, Total } from "@/activity/activity-queries";
import type { PageSize } from "@/activity/page-size";

/** What a press on the foot asked for: a move to a page, or another size of a page. */
type Asked = Readonly<Record<string, string>> | PageSize;

/** A page of as many entries, with the places the pages around it are reached from. */
function pageOf(rows: number, next: string | null, previous: string | null): Page {
  const entries = Array.from({ length: rows }, (_entry, index) => ({ seq: 1000 - index, at: 1_700_000_000_000, by: "mira@example.com", action: "login" as const, detail: {}, site: null }));

  return { ok: true, entries, logins: {}, next, previous } as Page;
}

/** Draw the foot at a query, and answer everything a press asks for. */
function drawn(query: string, page: Page, more: { readonly total?: Total; readonly size?: PageSize; readonly busy?: boolean } = {}): { readonly asked: Asked[]; readonly says: () => string | null } {
  const asked: Asked[] = [];
  render(
    <ActivityFoot
      query={new URLSearchParams(query)}
      page={page}
      total={more.total}
      size={more.size ?? "50"}
      onSize={(size) => asked.push(size)}
      onMove={(place) => asked.push(place)}
      busy={more.busy ?? false}
    />,
  );

  return { asked, says: () => document.querySelector("nav > span")?.textContent ?? null };
}

/** The ways of the foot that a press can take, in their order. */
function buttons(): readonly string[] {
  return within(document.body)
    .queryAllByRole("button")
    .flatMap((way) => ((way as HTMLButtonElement).disabled ? [] : [way.textContent ?? ""]));
}

afterEach(cleanup);
afterAll(clearPage);

describe("the foot of the log", () => {
  // Drift: a total would be said as exact when the count stopped short of the log's start, an old count below the page's own last entry would be shown, or a short list would grow controls it has no use for.
  test.each([
    ["the first page of a counted log", "", pageOf(50, "951", null), { total: { ok: true, total: 1240, whole: true } }, ["1 to 50 of 1,240", ["Next page"], true]],
    ["the first page before the count is read", "", pageOf(50, "951", null), {}, ["1 to 50", ["Next page"], true]],
    ["a log longer than was counted", "", pageOf(50, "951", null), { total: { ok: true, total: 10_000, whole: false } }, ["1 to 50 of 10,000+", ["Next page"], true]],
    ["a narrowed log longer than was counted", "kind=sites", pageOf(50, "951", null), { total: { ok: true, total: 73, whole: false } }, ["1 to 50 of 73+", ["Next page"], true]],
    ["a count older than the page", "after=900&from=101", pageOf(50, "851", "900"), { total: { ok: true, total: 120, whole: true } }, ["101 to 150", ["First page", "Previous page", "Next page"], true]],
    ["the second page", "after=951&from=51", pageOf(50, "901", "950"), { total: { ok: true, total: 1240, whole: true } }, ["51 to 100 of 1,240", ["First page", "Previous page", "Next page"], true]],
    ["the third page", "after=901&from=101", pageOf(50, "851", "900"), { total: { ok: true, total: 1240, whole: true } }, ["101 to 150 of 1,240", ["First page", "Previous page", "Next page"], true]],
    ["the last page, which tells the total itself", "after=901&from=101", pageOf(7, null, "900"), {}, ["101 to 107 of 107", ["First page", "Previous page"], true]],
    ["a later page whose address names no first entry", "after=901", pageOf(50, "851", "900"), { total: { ok: true, total: 1240, whole: true } }, [null, ["First page", "Previous page", "Next page"], true]],
    ["a page gone back to that reached the start", "back=951&from=51", pageOf(20, "981", null), { total: { ok: true, total: 70, whole: true } }, ["1 to 20 of 70", ["Next page"], true]],
    ["a list of one short page", "", pageOf(12, null, null), {}, ["1 to 12 of 12", [], false]],
    ["a list of one page above the smallest size", "", pageOf(120, null, null), { size: "200" as const }, ["1 to 120 of 120", [], true]],
    ["a page being replaced", "after=951&from=51", pageOf(50, "901", "950"), { busy: true, total: { ok: true, total: 1240, whole: true } }, [null, [], true]],
  ] as const)("on %s", (_what, query, page, more, [says, ways, sized]) => {
    const foot = drawn(query, page, more);

    expect([foot.says(), buttons(), within(document.body).queryByRole("combobox", { name: "Entries per page" }) !== null]).toEqual([says, [...ways], sized]);
  });

  // Drift: a way would lead to a page that repeats or skips entries, count its rows from the wrong number, or go back by a place when the list's own start is one page away.
  test.each([
    ["Next page", "after=901&from=101", pageOf(50, "851", "900"), "50", { after: "851", from: "151" }],
    ["Previous page", "after=901&from=101", pageOf(50, "851", "900"), "50", { back: "900", from: "51" }],
    ["Previous page", "after=951&from=51", pageOf(50, "901", "950"), "50", {}],
    ["Previous page", "after=901&from=101", pageOf(100, "801", "900"), "100", {}],
    ["Previous page", "after=901", pageOf(50, "851", "900"), "50", { back: "900" }],
    ["First page", "after=901&from=101", pageOf(50, "851", "900"), "50", {}],
    ["Next page", "after=901", pageOf(50, "851", "900"), "50", { after: "851" }],
  ] as const)("%s at %s leads on", (way, query, page, size, place) => {
    const foot = drawn(query, page, { size });
    fireEvent.click(within(document.body).getByRole("button", { name: way }));

    expect(foot.asked).toEqual([place]);
  });

  // Drift: the choice of a size would name sizes the server refuses, or a pick would not reach the screen.
  test("offers the three sizes of a page, the chosen one shown, and hands a pick on", async () => {
    const foot = drawn("", pageOf(50, "951", null), { size: "100" });
    const select = within(document.body).getByRole("combobox", { name: "Entries per page" });
    const shown = select.querySelector("[data-slot='select-value']")?.textContent;
    await act(async () => fireEvent.click(select));
    const options = await within(document.body).findAllByRole("option");
    const offered = options.map((option) => option.textContent);
    await act(async () => fireEvent.keyDown(options[2] as HTMLElement, { key: "Enter" }));

    expect([shown, offered, foot.asked]).toEqual(["100 per page", ["50 per page", "100 per page", "200 per page"], ["200"]]);
  });
});
