// The frame every dashboard page sits in: the title, the tabs, the result of the last change, then the page.

import { html, raw } from "hono/html";

import type { Html, Page, Tab, Visit } from "../records";
import { type Notice, refusalSentence } from "./notices";
import { STYLE } from "./style";

/** The tabs, in the order shown, and the path each opens. */
const TABS: readonly { readonly tab: Tab; readonly path: string; readonly label: string }[] = [
  { tab: "sites", path: "/", label: "Sites" },
  { tab: "tokens", path: "/tokens", label: "Tokens" },
  { tab: "settings", path: "/settings", label: "Settings" },
  { tab: "activity", path: "/activity", label: "Activity" },
  { tab: "usage", path: "/usage", label: "Usage" },
  { tab: "domain", path: "/domain", label: "Domain" },
];

/** What the frame shows around a page. */
interface Look {
  /** The install's `dashboard_title`. */
  readonly title: string;

  /** The nonce the response's policy allows one style element under. */
  readonly nonce: string;

  /** The result of the change that led here. */
  readonly notice?: Notice;

  /** Which tabs are shown beside the four every dashboard has: `domain` adds the Domain tab, and `none` shows no tab at all, as on the setup page. */
  readonly tabs?: "domain" | "none";
}

function tabLink(entry: (typeof TABS)[number], current: Tab): Html {
  if (entry.tab === current) return html`<li><a href="${entry.path}" aria-current="page">${entry.label}</a></li>`;

  return html`<li><a href="${entry.path}">${entry.label}</a></li>`;
}

function tabList(current: Tab, tabs: Look["tabs"]): Html {
  if (tabs === "none") return html``;

  const shown = TABS.filter((entry) => entry.tab !== "domain" || tabs === "domain");

  return html`<nav aria-label="Tabs"><ul>${shown.map((entry) => tabLink(entry, current))}</ul></nav>`;
}

function noticeLine(notice: Notice | undefined): Html {
  if (notice === undefined) return html``;

  return html`<p class="notice ${notice.kind}" role="status">${notice.text}</p>`;
}

/**
 * The hidden field every form carries.
 *
 * @returns an input named `csrf` holding the visit's token
 */
export function csrfField(visit: Pick<Visit, "csrf">): Html {
  return html`<input type="hidden" name="csrf" value="${visit.csrf}">`;
}

/**
 * Build the page that says why something is not shown.
 *
 * @param refusal - the code of an action's refusal and what it is about
 * @returns a page holding the table's sentence for the code, as a status message
 */
export function refusedPage(place: Pick<Page, "tab" | "heading" | "status">, refusal: { readonly code: string; readonly about?: string }): Page {
  const body = html`<p class="notice refused" role="status">${refusalSentence(refusal.code, refusal.about)}</p>`;

  return { ...place, body };
}

/**
 * Put the frame around a page.
 *
 * @returns the whole document; it loads nothing from anywhere, and its one style element carries the nonce
 */
export function framePage(page: Page, look: Look): Html {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${page.heading} - ${look.title}</title>
<style nonce="${look.nonce}">${raw(STYLE)}</style>
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<header>
<p class="brand">${look.title}</p>
${tabList(page.tab, look.tabs)}
</header>
<main id="content">
<h1>${page.heading}</h1>
${noticeLine(look.notice)}
${page.body}
</main>
</body>
</html>`;
}
