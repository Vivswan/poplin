// The open pages that show the data of before, once the demo started from the seed: every seed gives each site a new id, so the rows of such a page name sites that are gone.
//
//   a page of the dashboard             stale: it is loaded anew when it next asks for anything by script
//   a sample site in a tab of its own   left as it is: its old address leads to the site that holds its name now
//   the page a navigation replaces      left as it is: the answer to that navigation is drawn from the new data

/** An open page, as a worker's clients name it. `url` is the address the page was first loaded at. */
interface OpenPage {
  readonly id: string;
  readonly url: string;
  readonly frameType: string;
}

/** The request the demo started from the seed for. `clientId` is the page that asked: for a navigation, where a browser names one, the page it replaces. */
interface Asked {
  readonly mode: string;
  readonly clientId: string;
  readonly resultingClientId: string;
}

/**
 * Pick the open pages that show the data of before a start from the seed.
 *
 * @param served - the address every sample site the demo serves starts with
 * @returns the id of each such page: every top-level page but a sample site's, and but the two a navigation that started the demo names
 */
export function stalePages(pages: readonly OpenPage[], asked: Asked, served: string): readonly string[] {
  const replaced = asked.mode === "navigate" ? [asked.clientId, asked.resultingClientId] : [];
  const stale = pages.filter((page) => page.frameType === "top-level" && !page.url.startsWith(served) && !replaced.includes(page.id));

  return stale.map((page) => page.id);
}
