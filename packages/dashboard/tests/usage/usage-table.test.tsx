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

/** When the answers were read: noon of the day they are of in the time zone the tests run in, whichever it is, so the reader's date is that day. */
const NOON = new Date(2026, 10, 15, 12).getTime();

/** A line with no setting, no link, and a number that is exact, but for what a test names. */
function line(what: Line["what"], used: number | null, limit: number | null, more: Partial<Line> = {}): Line {
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
  official: { at: Date.UTC(2026, 10, 15, 14, 5), behind: 600_000 },
  lines: [
    line("host_stored", 5_099_999, 10_000_000_000, { link: PAGES.storage }),
    line("host_requests", 1318, 100_000, { link: PAGES.requests }),
    line("rows_read", 13_902, 5_000_000, { link: PAGES.database }),
    line("storage_writes", 41_200, 1_000_000, { link: PAGES.storage }),
    line("storage_reads", 310_000, 10_000_000, { link: PAGES.storage }),
  ],
};

async function draw(usage: Usage, read: number = NOON): Promise<void> {
  await drawAt(
    "/usage",
    <TooltipProvider>
      <UsageTable usage={usage} read={read} />
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
      "Storage, all sites1.2 GBof 9 GB13%Change the limitSee it at Provider",
      "Files156No limit",
      "Requests today1,240of 100,0001%Change the limitSee it at Provider",
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

    const named: readonly (readonly [string, string])[] = [
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
  // The figure of the storage adds up the most each part held in a day: read as what the account holds, or as the most it held, it says more than the account ever had.
  test("shows the host's own figures as exact numbers under their own names, the storage as the most it can have been, and says when they were read and how far behind they run", async () => {
    await draw(OFFICIAL);

    expect([officialLine(), tableRows().slice(1)]).toEqual([
      `Provider's own figures, as of ${momentIn(Date.UTC(2026, 10, 15, 14, 5))}. They run about 10 minutes behind. "Account" lines count the whole account, not only poplin.`,
      [
        ["Account storage, last 24 hours", "at most 5.1 MB", "10 GB", "0%", ""],
        ["Account requests today", "1,318", "100,000", "1%", ""],
        ["Database rows read today", "13,902", "5,000,000", "0%", ""],
        ["Storage writes since 01 Nov UTC", "41,200", "1,000,000", "4%", ""],
        ["Storage reads since 01 Nov UTC", "310,000", "10,000,000", "3%", ""],
      ],
    ]);
  });

  // Drift: the day's and the month's numbers are of a UTC day; called "today" and "this month" on a reader's other date, they read as numbers of a day they are not of.
  test("names the UTC day and month of the numbers where the reader's date was another when they were read, in the table, on a phone, and in every name a screen reader hears", async () => {
    await draw({ ...OWN, lines: [line("requests", 1240, 100_000, { setting: "requests_per_day", link: PAGES.requests }), line("storage_reads", 310_000, 10_000_000)] }, new Date(2026, 11, 2, 12).getTime());

    expect([tableRows().slice(1), phoneRows(), hostLinks().map(([name]) => name), screen.getAllByRole("button", { name: /^Change/ }).map((way) => way.getAttribute("aria-label"))]).toEqual([
      [
        ["Requests on 15 Nov UTC", "1,240", "100,000", "1%", ""],
        ["Storage reads since 01 Nov UTC", "310,000", "10,000,000", "3%", ""],
      ],
      ["Requests on 15 Nov UTC1,240of 100,0001%Change the limitSee it at Provider", "Storage reads since 01 Nov UTC310,000of 10,000,0003%"],
      ["Requests on 15 Nov UTC: see it at Provider", "Requests on 15 Nov UTC: see it at Provider"],
      ["Change the limit of Requests on 15 Nov UTC", "Change the limit of Requests on 15 Nov UTC"],
    ]);
  });

  // Drift: a figure the host gave none of would read as 0, which is a quiet account; a count the account never passed would read as what it holds now; and a processing time would be written as a count with no unit.
  test("says Not read for a figure the host gave none of, at most before what the account holds, and writes a processing time in milliseconds", async () => {
    await draw({
      ...OWN,
      official: { at: Date.UTC(2026, 10, 15, 14, 5), behind: null },
      lines: [
        line("database_size", 1_400_000, 500_000_000, { link: PAGES.database }),
        line("host_database_size", 2_300_001, 5_000_000_000),
        line("host_files", 212, null),
        line("host_uploads", null, null),
        line("host_errors", 18, null),
        line("host_stopped", 0, null),
        line("host_slowest", 2.7, 10),
        line("jobs_started", 6, null),
        line("jobs_done", 5, null),
        line("jobs_failed", 0, null),
        line("jobs_running", null, 100),
      ],
    });

    expect([officialLine(), tableRows().slice(1), phoneRows().filter((row) => row.includes("Not read")), screen.queryAllByRole("button", { name: /Requests are stopped/ }).length]).toEqual([
      `Provider's own figures, as of ${momentIn(Date.UTC(2026, 10, 15, 14, 5))}. "Account" lines count the whole account, not only poplin.`,
      [
        ["Database size", "1.4 MB", "500 MB", "0%", ""],
        ["Account database size", "at most 2.4 MB", "5 GB", "0%", ""],
        ["Account files stored", "at most 212", "No limit", "", ""],
        ["Uploads left unfinished", "Not read", "No limit", "", ""],
        ["Account errors today", "18", "No limit", "", ""],
        ["Requests stopped by a limit today", "0", "No limit", "", ""],
        ["Processing time, slowest 1 in 100, today", "2.7 ms", "10 ms", "", ""],
        ["Background jobs started today", "6", "No limit", "", ""],
        ["Background jobs done today", "5", "No limit", "", ""],
        ["Background jobs failed today", "0", "No limit", "", ""],
        ["Background jobs running now", "Not read", "100", "", ""],
      ],
      ["Uploads left unfinishedNot readNo limit", "Background jobs running nowNot readof 100"],
      0,
    ]);
  });

  // Drift: the host stops a request only when it says so, and counts those on a line of their own; a slow day written as a limit passed would read as an emergency while no request was stopped.
  // A sign with no word beside it says nothing until a pointer rests on it, while the line at nine tenths of its limit says so in words.
  test("above its limit the processing time says Slow beside a sign with a hint that names the line of the stopped requests, the hint in words on a phone, and never the words of a limit passed", async () => {
    await draw({ ...OWN, lines: [line("host_stopped", 0, null), line("host_slowest", 27.9, 10)] });
    const hint = "Requests are stopped only when Provider says so: see Requests stopped by a limit.";

    expect([tableRows().slice(1), screen.getAllByRole("button", { name: /Requests are stopped/ }).map((sign) => [sign.getAttribute("aria-label"), sign.tagName]), phoneRows()]).toEqual([
      [
        ["Requests stopped by a limit today", "0", "No limit", "", ""],
        ["Processing time, slowest 1 in 100, today", "27.9 ms", "10 ms", "Slow", ""],
      ],
      [[`Processing time, slowest 1 in 100, today: ${hint}`, "BUTTON"]],
      ["Requests stopped by a limit today0No limit", `Processing time, slowest 1 in 100, today27.9 msof 10 msSlow${hint}`],
    ]);
  });

  // Drift: a kept key that stopped working must say so in one plain line and leave the install's own numbers on the screen, never an empty or a broken one.
  test.each([
    [null, null],
    [{ refusal: "key_refused", right: null }, "The kept key no longer works. Open Domain and press Repair: it makes a new key. The numbers here are poplin's own count."],
    [{ refusal: "lacks_right", right: "Figures: Read" }, "The kept key has no permission to read usage: Figures: Read. Open Domain and press Repair: it makes a new key. The numbers here are poplin's own count."],
    [{ refusal: "lacks_right", right: null }, "The kept key has no permission to read usage. Open Domain and press Repair: it makes a new key. The numbers here are poplin's own count."],
    [{ refusal: "unreachable", right: null }, "Provider did not answer. The numbers here are poplin's own count."],
  ] as const)("over the install's own numbers, %j reads %p", async (official, says) => {
    await draw({ ...OWN, official });

    expect([officialLine(), tableRows().length]).toEqual([says, OWN.lines.length + 1]);
  });

  // Drift: a host named by a plain word, as the preview's is, would start the line over the table with a small letter, while its links keep the word as it is.
  test.each([
    [{ at: Date.UTC(2026, 10, 15, 14, 5), behind: null }, `The host's own figures, as of ${momentIn(Date.UTC(2026, 10, 15, 14, 5))}. "Account" lines count the whole account, not only poplin.`],
    [{ refusal: "unreachable", right: null }, "The host did not answer. The numbers here are poplin's own count."],
  ] as const)("a host named in plain words starts the line %j with a capital and keeps its own letters in a link", async (official, says) => {
    await draw({ ...OWN, host: "the host", official });

    expect([officialLine(), hostLinks().at(-1)?.[1]]).toEqual([says, "See it at the host"]);
  });
});
