// How the Sites screen reads its data: one page of the table and one site, each kept under a key that every change of a site makes stale, and the files of a site's live version, a folder at a time.

import { unwrapped } from "@poplin/core/src/sites/references";
import {
  type InfiniteData,
  keepPreviousData,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import type { Site } from "@/lib/sites";
import { filterOf, sortOf } from "@/sites/sites-query";

/** The first part of every key the sites' data is kept under: a change of a site marks all of it stale, so the table and the panel read again. */
export const SITES_KEY = ["sites"] as const;

/** How the dashboard's own address of a site's panel begins: the site's label follows. */
const PANEL_ADDRESS = `${location.origin}${BOOT.base}/sites/`;

/** One page of the table as the server answers it: the sites, the name of each login by its id, and the cursor of the following page or `null`. */
type Page = InferResponseType<typeof api.sites.$get, 200>;

/** One site as the server answers it: the site, and the name of each login by its id. */
export type Shown = InferResponseType<(typeof api.sites)[":site"]["$get"], 200>;

/** One page of a folder as the server answers it: its folders and its files by their paths, the cursor of the following page or `null`, and how many files the whole version holds. */
type FolderPage = InferResponseType<(typeof api.sites)[":site"]["files"]["$get"], 200>;

/** One folder of a site's files as far as it is read: its pages in the order they were read, and the way to the following one. */
export type FolderRead = UseInfiniteQueryResult<InfiniteData<FolderPage>>;

/** What names the site whose files are read: its id and its versions, which what is read is kept under, its label, which the server is asked by, and its live version. */
type FilesSite = Pick<Site, "id" | "label" | "live_version" | "versions">;

/** How one folder is read and kept: what it is kept under, how a page is asked for, and where the following page starts. */
type FolderQuery = UseInfiniteQueryOptions<FolderPage, Error, InfiniteData<FolderPage>, readonly unknown[], string | null>;

/**
 * What the server is asked to find: the text as typed, or the site's label out of the dashboard's own address of a site's panel, as copied from the browser's bar.
 *
 * The server knows a site by its label and by its links, and this address is neither: it is the dashboard's.
 */
function soughtIn(typed: string): string {
  const text = unwrapped(typed);
  if (!text.startsWith(PANEL_ADDRESS)) return typed.trim();

  const [label = ""] = text.slice(PANEL_ADDRESS.length).split(/[/?#]/u);

  return label === "" ? typed.trim() : label;
}

/** What the table's address asks of the server, with only the keys and values the server knows. */
function pageQueryOf(query: URLSearchParams): NonNullable<Parameters<typeof api.sites.$get>[0]>["query"] {
  const filter = filterOf(query);
  const sort = sortOf(query);
  const search = soughtIn(query.get("q") ?? "");
  const after = query.get("after");

  return {
    ...(filter === "trash" ? { view: "trash" as const } : {}),
    ...(filter === "trash" || filter === "all" ? {} : { access: filter }),
    ...(search === "" ? {} : { q: search }),
    ...(sort.key === "updated" && sort.descending
      ? {}
      : { sort: sort.key as "updated" | "title" | "name" | "access", dir: sort.descending ? ("desc" as const) : ("asc" as const) }),
    ...(after === null ? {} : { after }),
  };
}

/**
 * Read the page of the table the address asks for.
 *
 * The page before stays shown while the next one is on its way, so the table does not empty at every press.
 */
export function useSitesPage(query: URLSearchParams): UseQueryResult<Page> {
  const asked = pageQueryOf(query);

  return useQuery({ queryKey: [...SITES_KEY, "page", asked], queryFn: () => answerOf(api.sites.$get({ query: asked })), placeholderData: keepPreviousData });
}

/** The key one site's data is kept under, by the site's label. */
export function siteKey(label: string): readonly unknown[] {
  return [...SITES_KEY, "one", label];
}

/**
 * Read one site.
 *
 * @param label - the site's label, from the address
 */
export function useSite(label: string): UseQueryResult<Shown> {
  return useQuery({ queryKey: siteKey(label), queryFn: () => answerOf(api.sites[":site"].$get({ param: { site: label } })) });
}

/**
 * Name the version a site serves now, apart from every other: by the site's id, the number of its live version, and the moment that version was published.
 *
 * A new name leaves the id as it is, and a new link changes it. The moment tells a version from a later one published under its number.
 * An import of the site's backup keeps the three of each version it holds and stores the files anew: pages kept under the name of the version it makes live are still that version's, and the server refuses to read on from them.
 */
export function siteFilesKey(site: FilesSite): string {
  const published = site.versions.find((kept) => kept.number === site.live_version)?.published;

  return `${site.id} v${site.live_version} ${published}`;
}

/**
 * How one folder of the files of a site's live version is read and kept, a page at a time.
 *
 * A kept version's files never change, so a page that was read is kept for as long as the dashboard is open and never read again: each read is one listing of the storage, which the install counts against its day.
 * It is kept under `siteFilesKey`, so files that are not these are never shown for them.
 *
 * @param folder - the folder's path in the version; empty for the version's top
 */
function folderQuery(site: FilesSite, folder: string): FolderQuery {
  const version = String(site.live_version);
  const inside = folder === "" ? {} : { folder };

  return {
    queryKey: [...SITES_KEY, "files", siteFilesKey(site), folder],
    queryFn: ({ pageParam }) => answerOf(api.sites[":site"].files.$get({ param: { site: site.label }, query: { version, ...inside, ...(pageParam === null ? {} : { cursor: pageParam }) } })),
    initialPageParam: null,
    getNextPageParam: (page) => page.next,
    staleTime: "static",
    gcTime: Number.POSITIVE_INFINITY,
  };
}

/**
 * Read one folder of the files of a site's live version: its first page once `open` holds, and each following one when it is asked for.
 *
 * @param folder - the folder's path in the version; empty for the version's top
 * @param open - whether the folder is read as soon as it is shown; a folder shown with `false` shows what is kept of it, and reads nothing
 */
export function useSiteFolder(site: FilesSite, folder: string, open: boolean): FolderRead {
  return useInfiniteQuery({ ...folderQuery(site, folder), enabled: open });
}

/**
 * The way to read a folder of a site's files when something asks for it, as a tree does when a folder is first opened.
 *
 * @returns a read of the folder at a path: it answers at once for a folder that is kept, reads the first page of one that is not, and rejects with the server's refusal
 */
export function useSiteFolderRead(site: FilesSite): (folder: string) => Promise<unknown> {
  const queries = useQueryClient();

  return (folder) => queries.infiniteQuery(folderQuery(site, folder));
}

/**
 * Read the address a site answers at once it is public under a name.
 *
 * A name no site may hold answers no address.
 *
 * @param name - the public name as it is typed; an empty one is not asked
 */
export function usePublicAddress(name: string): UseQueryResult<InferResponseType<(typeof api)["public-address"]["$get"], 200>> {
  return useQuery({
    queryKey: ["public-address", name],
    queryFn: () => answerOf(api["public-address"].$get({ query: { name } })),
    enabled: name !== "",
  });
}
