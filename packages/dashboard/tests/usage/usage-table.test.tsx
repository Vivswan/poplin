// The table of the Usage screen: what each line says of its number, where its link leads, and what the line over the table says of the host's own figures.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { momentIn } from "@/lib/timezone";
import type { Line, Usage } from "@/usage/usage-queries";
import { UsageTable } from "@/usage/usage-table";

import { drawAt } from "../lib/support/router";

/** The host's pages, as the server names them. */
const PAGES = { requests: "https://provider.example/requests", database: "https://provider.example/database", storage: "https://provider.example/storage" };

/** A line with no setting, no link, and a number that is exact, but for what a test names. */
function line(what: Line["what"], used: number, limit: number | null, more: Partial<Line> = {}): Line {
  return { what, used, limit, setting: null, about: false, link: null, ...more };
}

/** What an install without a kept key is answered: its own numbers, the rows of the database as its own count. */
const OWN: Usage = {
  ok: true,
  day: "2026-11-15",
  host: "Provider",
  official: null,
  lines: [
    line("stored", 1_200_000_000, 9_000_000_000, { setting: "max_total_size", link: PAGES.storage }),
    line("files", 156, null),
    line("requests", 1240, 100_000, { setting: "requests_per_day", link: PAGES.requests }),
    line("rows_read", 4_100_000, 5_000_000, { about: true, link: PAGES.database }),
    line("rows_written", 310, 100_000, { about: true, link: PAGES.database }),
  ],
};

/** What an install is answered once the host gave its own figures. */
const OFFICIAL: Usage = {
  ...OWN,
  official: { at: Date.UTC(2026, 10, 15, 14, 5) },
  lines: [
    line("host_stored", 5_000_000, 10_000_000_000, { link: PAGES.storage }),
    line("host_requests", 1318, 100_000, { link: PAGES.requests }),
    line("rows_read", 13_902, 5_000_000, { link: PAGES.database }),
    line("storage_writes", 41_200, 1_000_000, { link: PAGES.storage }),
    line("storage_reads", 310_000, 10_000_000, { link: PAGES.storage }),
  ],
};

async function draw(usage: Usage): Promise<void> {
  await drawAt(
    "/usage",
    <TooltipProvider>
      <UsageTable usage={usage} />
    </TooltipProvider>,
  );
}

/** The words of a piece of the page a person reads: the bar of a share draws none. */
function wordsOf(piece: Element): string {
  const read = piece.cloneNode(true) as Element;
  for (const bar of read.querySelectorAll("[role=progressbar]")) bar.remove();

  return read.textContent ?? "";
}

/** The rows of the table as the words of their cells, the headings first. */
function tableRows(): string[][] {
  return within(screen.getByRole("table", { name: "Usage" }))
    .getAllByRole("row")
    .map((row) => [...row.querySelectorAll("th, td")].map(wordsOf));
}

/** The rows of the phone's list as their words. */
function phoneRows(): string[] {
  return within(screen.getByRole("list", { name: "Usage" })).getAllByRole("listitem").map(wordsOf);
}

/** Every way to a page of the host, in the table and in the phone's list: its name for a screen reader, its words, and how it opens. */
function hostLinks(): (string | null)[][] {
  return [...document.querySelectorAll("a[target=_blank]")].map((link) => [link.getAttribute("aria-label"), link.textContent, link.getAttribute("href"), link.getAttribute("rel")]);
}

/** The line over the table, or `null` where there is none. */
function officialLine(): string | null {
  return document.querySelector("p")?.textContent ?? null;
}

afterEach(cleanup);
afterAll(clearPage);

describe("the table of the Usage screen", () => {
  // Drift: the install's own count of rows can read low, so it must say "about"; shown as bare numbers, it reads as the host's exact figure, and a count near the free plan's limit must warn as every other line does.
  test("says about before a number the install counted itself, sets each number beside its limit and its share, and warns near a limit", async () => {
    await draw(OWN);

    expect(tableRows()).toEqual([
      ["What", "Used", "Limit", "Share of the limit", "Actions"],
      ["Storage, all sites", "1.2 GB", "9 GB", "13%", ""],
      ["Files", "156", "No limit", "", ""],
      ["Requests today", "1,240", "100,000", "1%", ""],
      ["Database rows read today", "about 4,100,000", "5,000,000", "82%Near the limit", ""],
      ["Database rows written today", "about 310", "100,000", "0%", ""],
    ]);
    expect(phoneRows()).toEqual([
      "Storage, all sites1.2 GBof 9 GB13%See it at Provider",
      "Files156No limit",
      "Requests today1,240of 100,0001%See it at Provider",
      "Database rows read todayabout 4,100,000of 5,000,00082%Near the limitSee it at Provider",
      "Database rows written todayabout 310of 100,0000%See it at Provider",
    ]);
  });

  // Drift: the way to a line's limit would be called the same on every line again, and a screen reader's list of buttons would not say which limit each one changes.
  test("names each way to the setting of a limit by its line", async () => {
    await draw(OWN);
    const ways = within(screen.getByRole("table", { name: "Usage" }))
      .getAllByRole("button", { name: /^Change the limit of / })
      .map((way) => [way.getAttribute("aria-label"), way.getAttribute("href")]);

    expect(ways).toEqual([
      ["Change the limit of Storage, all sites", `${BOOT.base}/settings#setting-max_total_size`],
      ["Change the limit of Requests today", `${BOOT.base}/settings#setting-requests_per_day`],
    ]);
  });

  // Drift: five links with the same words tell a screen reader nothing; each must say which number it shows, lead to the host's page of that number, and open beside the console, never in its place.
  test("names each way to the host's page by its line, as an icon in the table and in words on a phone, and opens the page of that line in a new tab", async () => {
    await draw(OWN);

    const named = [
      ["Storage, all sites: see it at Provider", PAGES.storage],
      ["Requests today: see it at Provider", PAGES.requests],
      ["Database rows read today: see it at Provider", PAGES.database],
      ["Database rows written today: see it at Provider", PAGES.database],
    ];

    expect(hostLinks()).toEqual([...named.map(([name, page]) => [name, "", page, "noreferrer"]), ...named.map(([name, page]) => [name, "See it at Provider", page, "noreferrer"])]);
  });

  // Drift: an address is text of the server's; drawn as a link whatever it holds, a press could run it.
  test.each(["javascript:alert(1)", "http://provider.example/database", "database", ""])("draws no link for the address %p", async (link) => {
    await draw({ ...OWN, lines: [line("rows_read", 12_400, 5_000_000, { about: true, link })] });

    expect(hostLinks()).toEqual([]);
  });

  // Drift: the host's figures are exact and of the whole account; shown with "about", or under the names of the install's own lines, a person could not tell which number is whose.
  test("shows the host's own figures as exact numbers under their own names, and says when they were read", async () => {
    await draw(OFFICIAL);

    expect([officialLine(), tableRows().slice(1)]).toEqual([
      `Provider's own figures, as of ${momentIn(Date.UTC(2026, 10, 15, 14, 5))}.`,
      [
        ["Account storage", "5 MB", "10 GB", "0%", ""],
        ["Account requests today", "1,318", "100,000", "1%", ""],
        ["Database rows read today", "13,902", "5,000,000", "0%", ""],
        ["Storage writes this month", "41,200", "1,000,000", "4%", ""],
        ["Storage reads this month", "310,000", "10,000,000", "3%", ""],
      ],
    ]);
  });

  // Drift: a kept key that stopped working must say so in one plain line and leave the install's own numbers on the screen, never an empty or a broken one.
  test.each([
    [null, null],
    [{ refusal: "key_refused", right: null }, "The kept key no longer works. The numbers here are poplin's own count."],
    [{ refusal: "lacks_right", right: "Figures: Read" }, "The kept key has no right to read usage: Figures: Read. The numbers here are poplin's own count."],
    [{ refusal: "lacks_right", right: null }, "The kept key has no right to read usage. The numbers here are poplin's own count."],
    [{ refusal: "unreachable", right: null }, "Provider did not answer. The numbers here are poplin's own count."],
  ] as const)("over the install's own numbers, %j reads %p", async (official, says) => {
    await draw({ ...OWN, official });

    expect([officialLine(), tableRows().length]).toEqual([says, OWN.lines.length + 1]);
  });
});
