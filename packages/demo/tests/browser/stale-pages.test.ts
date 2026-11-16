import { expect, test } from "bun:test";

import { stalePages } from "../../src/browser/stale-pages";

/** The address every sample site the demo serves starts with, on an invented host. */
const SERVED = "https://demo.example.com/poplin/demo/served/";

/** The open pages of every case: two of the dashboard, a sample site in a tab of its own, and a frame inside a page. */
const PAGES = [
  { id: "sites", url: "https://demo.example.com/poplin/demo/", frameType: "top-level" },
  { id: "activity", url: "https://demo.example.com/poplin/demo/activity", frameType: "top-level" },
  { id: "sample", url: `${SERVED}sales-report--000000000000-p-poplin/`, frameType: "top-level" },
  { id: "frame", url: "https://demo.example.com/poplin/demo/", frameType: "nested" },
];

// Drift: a navigation that starts the demo from the seed leaves the other open tab on rows whose ids are gone, or a sample site's tab is loaded anew at an address that no longer answers.
test.each([
  ["a script's request marks the page that asked and the other one", { mode: "cors", clientId: "sites", resultingClientId: "" }, ["sites", "activity"]],
  ["a navigation marks every page but the one it replaces", { mode: "navigate", clientId: "sites", resultingClientId: "next" }, ["activity"]],
  ["a navigation that names only the page it makes marks every page but that one", { mode: "navigate", clientId: "", resultingClientId: "activity" }, ["sites"]],
])("after a start from the seed, %s; a sample site's tab and a frame are never marked", (_, asked, stale) => {
  expect(stalePages(PAGES, asked, SERVED)).toEqual(stale);
});
