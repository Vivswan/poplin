// How the files of a site are read: a folder at a time, each page once.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useSiteFolder, useSiteFolderRead } from "@/sites/site-queries";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The site whose files are read: its id, what names it, its live version, and when that version was published. */
const SITE = {
  id: "abc123def456",
  label: "trip-notes--abc123def456",
  live_version: 1,
  versions: [{ number: 1, published: 1_700_000_000_000, published_by: "mira@example.com" }],
} as unknown as Parameters<typeof useSiteFolder>[0];

/** The two pages of the site's top folder, by the query each is asked with: two files at the top and a file in each of two folders. */
const PAGES: Readonly<Record<string, object>> = {
  "version=1": { folders: ["docs"], files: [{ path: "a.txt", size: 1 }], next: "after-a", total: 4 },
  "cursor=after-a&version=1": { folders: ["more"], files: [{ path: "index.html", size: 2 }], next: null, total: 4 },
};

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
});
afterAll(clearPage);

// Drift: every change of a site marks the sites' data stale, and stale data is read again when it is next shown; a tree drawn anew asks for a folder it shows closed; and a site given another name is asked for under that name.
// A folder read again at any of these would list the storage for files that cannot have changed, which the install counts against its day.
// And a site restored from a backup may publish another version under the id and the number of one that was read: what was kept would show files the site no longer holds.
test("a folder is read a page at a time, each page once: not when it is shown again, after a change marked the sites' data stale, when a tree asks for it again, or under the site's new name; a version published anew is read anew", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // The keys are put in one order: the order an address has them in is nothing the server reads.
    const query = [...new URL(String(input), "https://dashboard.example.com").searchParams].map(([key, value]) => `${key}=${value}`).sort().join("&");
    asked.push(query);

    return Response.json({ ok: true, ...PAGES[query] });
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const files = (read: ReturnType<typeof useSiteFolder>): readonly string[] => read.data?.pages.flatMap((page) => page.files.map((file) => file.path)) ?? [];

  const folded = renderHook(() => useSiteFolder(SITE, "", false), { wrapper });
  const unasked = asked.length;
  const first = renderHook(() => useSiteFolder(SITE, "", true), { wrapper });
  await waitFor(() => expect(files(first.result.current).length).toBe(1));
  await act(async () => {
    await first.result.current.fetchNextPage();
  });
  first.unmount();
  folded.unmount();
  await act(async () => client.invalidateQueries());
  const again = renderHook(() => useSiteFolderRead(SITE), { wrapper });
  await act(async () => {
    await again.result.current("");
  });
  const renamed = renderHook(() => useSiteFolder({ ...SITE, label: "trip-diary--abc123def456" } as typeof SITE, "", true), { wrapper });
  const kept = [files(renamed.result.current), renamed.result.current.hasNextPage, [...asked]];
  const anew = { ...SITE, versions: [{ number: 1, published: 1_700_000_100_000, published_by: "mira@example.com" }] } as unknown as typeof SITE;
  const republished = renderHook(() => useSiteFolder(anew, "", true), { wrapper });
  await waitFor(() => expect(files(republished.result.current).length).toBe(1));

  expect([unasked, kept, asked.slice(2)]).toEqual([0, [["a.txt", "index.html"], false, ["version=1", "cursor=after-a&version=1"]], ["version=1"]]);
});
