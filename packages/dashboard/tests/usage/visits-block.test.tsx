// The Visits block of the Usage screen: which lines it draws from an answer, what it says beside them, and what a pick asks of the server.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { VisitsBlock } from "@/usage/visits-block";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The key the block keeps its choice under. */
const CHOICE_KEY = "poplin.usage.visits";

/** The three days every answer spans. */
const DAYS = ["2026-11-13", "2026-11-14", "2026-11-15"];

/** The counts of all sites together, a day each. */
const ALL = [1200, 0, 2300];

/** The counts of the first two sites, a day each. */
const COUNTED = [
  [700, 0, 1100],
  [40, 0, 62],
];

/** Seven sites as the server knows them. */
const SITES = ["Handbook", "Launch deck", "Pricing", "Notes", "Report", "Offer", "Board"].map((title, at) => ({
  id: `site${at}`.padEnd(12, "0"),
  title,
  name: title.toLowerCase().replace(" ", "-"),
  counts: COUNTED[at] ?? [0, 0, 0],
}));

/** How long the page is given to settle, in milliseconds. */
const SETTLED_MS = 30;

/** Every read of the visits the block made, as the query it asked. */
const asked: string[] = [];

function sum(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}

/** A choice as the browser keeps it: the first sites of the list, each in the place of its colour. */
function keep(sites: number, hidden: readonly string[] = []): void {
  localStorage.setItem(
    CHOICE_KEY,
    JSON.stringify({ range: "30", sites: SITES.slice(0, sites).map((site, slot) => ({ id: site.id, title: site.title, slot })), hidden }),
  );
}

function kept(): { readonly hidden: readonly string[]; readonly sites: readonly { readonly slot: number }[] } {
  return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}");
}

/** Draw the block, with the visits answered for the sites asked for and the list of sites answered whole. */
async function draw(all: readonly number[] = ALL, by = "day"): Promise<void> {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search, searchParams } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname === `${BOOT.base}/data/sites`)
      return Response.json({ ok: true, sites: SITES.map(({ counts: _counts, ...site }) => site), next: null, logins: {} });

    asked.push(search);
    const ids = (searchParams.get("sites") ?? "").split(",");
    const sites = SITES.filter((site) => ids.includes(site.id)).map(({ id, name, counts }) => ({ id, name, total: sum(counts), counts }));

    return Response.json({ ok: true, range: Number(searchParams.get("range")), by, days: DAYS, all: { total: sum(all), counts: all }, sites });
  }) as typeof fetch;

  await doing(() => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <VisitsBlock />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  await within(document.body).findByText(/^in (30 days|1 year)$|^No visits yet\.$/);
}

/** Let the graph measure its place and a list finish opening, which both happen a moment after what caused them. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SETTLED_MS));
  });
}

/** Do something to the page, and let it settle. */
async function doing(something: () => void): Promise<void> {
  await act(async () => something());
  await settle();
}

function lines(): readonly (string | null)[] {
  return [...document.querySelectorAll("path[data-line]")].map((line) => line.getAttribute("data-line")).sort();
}

function rowsOf(table: HTMLElement): readonly (readonly string[])[] {
  return within(table)
    .getAllByRole("row")
    .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent ?? ""));
}

afterEach(() => {
  cleanup();
  asked.length = 0;
  globalThis.fetch = OWN_FETCH;
});
afterAll(clearPage);

describe("the Visits block", () => {
  // Drift: the total would go when a site is picked, a picked site would draw no line or lose its name, or the table a screen reader hears would hold other numbers than the lines.
  test("draws all sites alone at first, and with picked sites a line each, named under the graph with its sum, over a table of the same numbers", async () => {
    await draw();
    const alone = [lines(), within(document.body).queryByRole("list", { name: "Lines" })];
    cleanup();
    keep(3);
    await draw();
    const ids = SITES.slice(0, 3).map((site) => site.id);

    expect(alone).toEqual([["all"], null]);
    expect([asked.at(-1), lines()]).toEqual([`?range=30&sites=${ids.join("%2C")}`, ["all", ...ids]]);
    expect(within(document.body).getByRole("heading", { name: "Visits" }).parentElement?.textContent).toContain("about 3,500 in 30 days");
    expect(
      within(within(document.body).getByRole("list", { name: "Lines" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["All sitesabout 3,500", "Handbookabout 1,800", "Launch deckabout 100", "Pricingunder 10"]);
    expect(rowsOf(within(document.body).getByRole("table", { name: "Visits by day" }))).toEqual([
      ["Day", "All sites", "Handbook", "Launch deck", "Pricing"],
      ["13 Nov 2026", "1,200", "700", "40", "0"],
      ["14 Nov 2026", "0", "0", "0", "0"],
      ["15 Nov 2026", "2,300", "1,100", "62", "0"],
    ]);
  });

  // Drift: an install nobody opened yet would draw empty axes, which read as a broken graph.
  test("says there are no visits yet, and draws no graph and no sum, while nothing was counted", async () => {
    await draw([0, 0, 0]);

    const drawn = [
      document.querySelector("svg path[data-line]"),
      within(document.body).queryByRole("table"),
      within(document.body).queryByText(/^in 30 days$/),
    ];

    expect([within(document.body).getByText("No visits yet.").tagName, ...drawn]).toEqual(["P", null, null, null]);
  });

  // Drift: the keys would read no day, or the numbers of another day than the one marked.
  test("reads a day's numbers from the keyboard, the last day first, and shows them beside the day", async () => {
    keep(1);
    await draw();
    const day = within(document.body).getByRole("slider", { name: "Day" });
    const shown = (): string | null | undefined => document.querySelector("[data-slot=day-numbers]")?.textContent;

    await doing(() => fireEvent.focus(day));
    const last = [day.getAttribute("aria-valuetext"), shown()];
    await doing(() => fireEvent.change(day, { target: { value: "0" } }));
    const first = [day.getAttribute("aria-valuetext"), shown()];
    await doing(() => fireEvent.blur(day));

    expect([last, first, shown()]).toEqual([
      ["15 Nov 2026, All sites 2,300, Handbook 1,100", "15 Nov 2026All sites2,300Handbook1,100"],
      ["13 Nov 2026, All sites 1,200, Handbook 700", "13 Nov 2026All sites1,200Handbook700"],
      undefined,
    ]);
  });

  // Drift: a pick would not reach the server, a small cap would come back and stop a sixth site, two picked sites would share a look, or every listed site could not be ticked or unticked at once.
  test("asks for a site once it is ticked, lets a sixth be ticked, ticks every listed site at once with a look of its own each, and clears them all", async () => {
    keep(4);
    await draw();
    await doing(() => fireEvent.click(within(document.body).getByRole("combobox", { name: "Compare sites" })));
    const report = await within(document.body).findByRole("option", { name: /^Report/ });
    // The popup and its list are named: a screen reader says what was opened and what the options are.
    const named = [within(document.body).getAllByRole("dialog", { name: "Compare sites" }).length, within(document.body).getAllByRole("listbox", { name: "Sites" }).length];
    await doing(() => fireEvent.click(report));
    await waitFor(() => expect(asked.at(-1)).toContain(SITES[4]?.id ?? "none"));
    await settle();
    const free = within(document.body)
      .getAllByRole("option")
      .map((option) => [option.querySelector("span")?.textContent, option.getAttribute("aria-selected"), option.getAttribute("aria-disabled")]);
    await doing(() => fireEvent.click(within(document.body).getByRole("button", { name: "Select all" })));
    const all = kept().sites.map((site) => site.slot);
    await settle();
    const looks = [...within(document.body).getByRole("list", { name: "Lines" }).querySelectorAll("line")].map((line) => `${line.getAttribute("stroke")} ${line.getAttribute("stroke-dasharray")}`);
    await doing(() => fireEvent.click(within(document.body).getByRole("button", { name: "Clear" })));

    expect(named).toEqual([1, 1]);
    expect([free.slice(4), all, [looks.length, new Set(looks).size], kept().sites]).toEqual([
      [
        ["Report", "true", null],
        ["Offer", "false", null],
        ["Board", "false", null],
      ],
      [0, 1, 2, 3, 4, 5, 6],
      [8, 8],
      [],
    ]);
  });

  // Drift: a big line would keep the small ones flat with no way to read them, the sum in the heading would go with its line, or the one line left could be switched off and leave an empty plot.
  test("draws only the lines switched on, keeps the sum of all sites in the heading, remembers the switches, and lets the last line not be switched off", async () => {
    keep(2, [SITES[1]?.id ?? ""]);
    await draw();
    const pressed = (): readonly (readonly [string | null, boolean])[] =>
      within(within(document.body).getByRole("list", { name: "Lines" }))
        .getAllByRole("button")
        .map((entry) => [entry.getAttribute("aria-pressed"), (entry as HTMLButtonElement).disabled]);
    const before = [lines(), pressed()];

    await doing(() => fireEvent.click(within(document.body).getByRole("button", { name: /^All sites/ })));

    expect(before).toEqual([
      ["all", SITES[0]?.id ?? ""],
      [
        ["true", false],
        ["true", false],
        ["false", false],
      ],
    ]);
    expect([lines(), pressed(), kept().hidden]).toEqual([
      [SITES[0]?.id ?? ""],
      [
        ["false", false],
        ["true", true],
        ["false", false],
      ],
      ["all", SITES[1]?.id ?? ""],
    ]);
    expect(within(document.body).getByRole("heading", { name: "Visits" }).parentElement?.textContent).toContain("about 3,500 in 30 days");
    expect(rowsOf(within(document.body).getByRole("table", { name: "Visits by day" }))[0]).toEqual(["Day", "Handbook"]);
  });

  // Drift: a line left alone would be drawn against the counts of a line that is hidden, flat at the foot, or a line of no visits would be placed by a count that is no number.
  test.each([
    ["all sites hidden, one site left", 1, ["all"], [SITES[0]?.id], true],
    ["one site left that nobody opened", 3, ["all", SITES[0]?.id, SITES[1]?.id], [SITES[2]?.id], false],
    ["every line hidden, which draws them all", 1, ["all", SITES[0]?.id], ["all", SITES[0]?.id], true],
  ])("with %s, each line drawn is placed by numbers, on a scale of the drawn lines alone", async (_state, sites, hidden, drawn, reaches) => {
    keep(sites, hidden as string[]);
    await draw();
    const paths = [...document.querySelectorAll("path[data-line]")].map((line) => (line.getAttribute("d") ?? "").split(/[ML]/).filter(Boolean));
    // Every line of the sample has a day of no visits, which stands at the foot of the plot.
    const heights = paths.flat().map((point) => Number(point.split(",")[1]));
    const marks = [...document.querySelectorAll("svg .visx-axis-left text")].map((mark) => mark.textContent);

    expect([lines(), paths.map((path) => path.length), heights.every(Number.isFinite), Math.min(...heights) < Math.max(...heights) / 2, marks.includes("NaN")]).toEqual([
      [...drawn].sort(),
      drawn.map(() => DAYS.length),
      true,
      reaches,
      false,
    ]);
  });

  // Drift: a point that sums a week would be read as one day's count.
  test("names a step as a week where the server answers a count a week", async () => {
    await draw(ALL, "week");
    const week = within(document.body).getByRole("slider", { name: "Week" });

    expect([week.getAttribute("aria-valuetext"), rowsOf(within(document.body).getByRole("table", { name: "Visits by week" }))[1]]).toEqual([
      "Week of 15 Nov 2026, All sites 2,300",
      ["Week of 13 Nov 2026", "1,200"],
    ]);
  });

  // Drift: a kept choice would send a range the server refuses, or a choice of another shape would break the screen.
  test.each([
    ["a kept range", JSON.stringify({ range: "365", sites: [], hidden: [] }), "?range=365", "in 1 year"],
    ["a kept value of another shape", JSON.stringify({ range: "7", sites: "all" }), "?range=30", "in 30 days"],
  ])("reads %s", async (_what, kept, query, words) => {
    localStorage.setItem(CHOICE_KEY, kept);
    await draw();
    await within(document.body).findByText(words, { exact: false });

    expect(asked).toEqual([query]);
  });
});
