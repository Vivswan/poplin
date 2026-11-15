// The frame every dashboard page sits in: the side with the sections, the page with its title, and the result of the last change.

import type { Update } from "@poplin/core/src/actions/update";
import { html, raw } from "hono/html";

import type { Html, Page, Tab, Visit } from "../records";
import { COPY_SCRIPT_PATH } from "./copy-script";
import { BRAND_MARK, ICONS } from "./icons";
import { type Notice, refusalSentence } from "./notices";
import { STYLE } from "./style";
import { THEMES, type Theme } from "./theme";

/** The sections of the side, in the order shown: the path each opens, and the pages that sit under it. A section of more than one page shows them as tabs. */
const SECTIONS: readonly Section[] = [
  { path: "/", label: "Sites", icon: "sites", pages: [{ tab: "sites", path: "/", label: "Sites" }] },
  { path: "/tokens", label: "Access", icon: "access", pages: [{ tab: "tokens", path: "/tokens", label: "Access" }] },
  {
    path: "/activity",
    label: "Activity",
    icon: "activity",
    pages: [
      { tab: "activity", path: "/activity", label: "Activity" },
      { tab: "usage", path: "/usage", label: "Usage" },
    ],
  },
  {
    path: "/settings",
    label: "Settings",
    icon: "settings",
    pages: [
      { tab: "settings", path: "/settings", label: "Settings" },
      { tab: "domain", path: "/domain", label: "Domain" },
    ],
  },
];

/** One section of the side. */
interface Section {
  readonly path: string;
  readonly label: string;
  readonly icon: keyof typeof ICONS;
  readonly pages: readonly { readonly tab: Tab; readonly path: string; readonly label: string }[];
}

/** What the frame shows around a page. */
interface Look {
  /** The install's `dashboard_title`. */
  readonly title: string;

  /** The nonce the response's policy allows one style element under. */
  readonly nonce: string;

  /** The result of the change that led here. */
  readonly notice?: Notice;

  /** The token of the visit, which the form that undoes a change carries. Without it a notice shows no way back. */
  readonly csrf?: string;

  /** The version of poplin the install runs, and the newer release it knows of. Shown at the foot of the side. */
  readonly running?: { readonly version: string; readonly update?: Update };

  /** The scheme this browser chose, and the path the page can be opened at again, which a new choice comes back to. Without it the page follows the system and the side shows no choice. */
  readonly theme?: { readonly chosen: Theme; readonly back: string };

  /** Set by a host whose install is a demo over sample data: the address its form posts to, to start the data over. A real install has none, and shows nothing of it. */
  readonly demo?: { readonly reset: string };

  /** What is shown beside the pages every dashboard has: `domain` adds the Domain tab, and `none` shows no side at all, as on the setup page. */
  readonly tabs?: "domain" | "none";
}

/** The pages of a section that this dashboard has: the Domain tab only on one built with a domain plug. */
function pagesOf(section: Section, tabs: Look["tabs"]): Section["pages"] {
  return section.pages.filter((entry) => entry.tab !== "domain" || tabs === "domain");
}

/** The link of one section. The section a page sits under is marked: as the page itself when it has no other page, as its parent otherwise. */
function sectionLink(section: Section, current: Tab, tabs: Look["tabs"]): Html {
  const own = pagesOf(section, tabs);
  if (!own.some((entry) => entry.tab === current)) return html`<li><a href="${section.path}">${ICONS[section.icon]}${section.label}</a></li>`;

  return html`<li><a href="${section.path}" aria-current="${own.length === 1 ? "page" : "true"}">${ICONS[section.icon]}${section.label}</a></li>`;
}

/** The choice of scheme: one form whose pressed button is the choice in force. */
function themeChoice(look: Look): Html {
  const { theme, csrf } = look;
  if (theme === undefined || csrf === undefined) return html``;

  const choices = Object.entries(THEMES).map(([name, label]) => html`<button type="submit" name="theme" value="${name}" aria-pressed="${name === theme.chosen ? "true" : "false"}">${label}</button>`);

  return html`<form class="seg" method="post" action="/theme" aria-label="Theme">${csrfField({ csrf })}<input type="hidden" name="back" value="${theme.back}">${choices}</form>`;
}

/** The newer release the install knows of, with the way to what changed in it. The link leaves the dashboard, so it opens beside it and carries no referrer. */
function news(look: Look): Html {
  const update = look.running?.update;
  if (update === undefined) return html``;

  return html`<p class="news"><b>${update.newest} is out</b> <a href="${update.notes}" target="_blank" rel="noreferrer">What changed</a></p>`;
}

/** The foot of the side: the newer release, the choice of scheme, and the version the install runs. */
function sideFoot(look: Look): Html {
  if (look.running === undefined) return html``;

  return html`\n<div class="about">${news(look)}${themeChoice(look)}<p>poplin ${look.running.version}</p></div>`;
}

function side(current: Tab, look: Look): Html {
  if (look.tabs === "none") return html``;

  return html`<aside class="side">
<p class="brand">${BRAND_MARK}${look.title}</p>
<nav aria-label="Sections"><ul>${SECTIONS.map((section) => sectionLink(section, current, look.tabs))}</ul></nav>${sideFoot(look)}
</aside>`;
}

/** The tabs above a page whose section holds more than one. */
function tabList(current: Tab, tabs: Look["tabs"]): Html {
  const section = SECTIONS.find((entry) => entry.pages.some((own) => own.tab === current));
  const own = section === undefined ? [] : pagesOf(section, tabs);
  if (tabs === "none" || own.length < 2) return html``;

  const links = own.map((entry) => (entry.tab === current ? html`<a href="${entry.path}" aria-current="page">${entry.label}</a>` : html`<a href="${entry.path}">${entry.label}</a>`));

  return html`<div class="tools"><nav class="tabs" aria-label="Tabs">${links}</nav></div>`;
}

/** The result of the last change, and with it the one press that takes a change back where the result names one. */
function noticeLine(look: Look): Html {
  const { notice } = look;
  if (notice === undefined) return html``;

  const line = html`<p class="notice ${notice.kind}" role="status">${notice.text}</p>`;
  if (notice.undo === undefined || look.csrf === undefined) return line;

  return html`<div class="result">${line}<form method="post" action="${notice.undo}">${csrfField({ csrf: look.csrf })}<button type="submit" class="txt">Undo</button></form></div>`;
}

/** The copy script's element. The setup page has no copy button and no script of its own origin to load, so its frame names none. */
function copyScript(look: Look): Html {
  return look.tabs === "none" ? html`` : html`\n<script src="${COPY_SCRIPT_PATH}" defer></script>`;
}

/** The line that says the install is a demo, with the one press that starts its data over. */
function demoLine(look: Look): Html {
  if (look.demo === undefined) return html``;

  return html`<div class="demo"><b>Demo</b><span>sample data, resets</span><form method="post" action="${look.demo.reset}"><button type="submit" class="txt">Reset</button></form></div>\n`;
}

function heading(page: Page): Html {
  if (page.panel === undefined) return html`<h1>${page.heading}</h1>`;

  return html`<h1><a href="${page.panel.back}">${page.heading}</a></h1>`;
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
 * @returns the whole document; it loads the copy script from its own origin and nothing else, the setup page's frame nothing at all, and its one style element carries the nonce
 */
export function framePage(page: Page, look: Look): Html {
  const classes = `app${look.tabs === "none" ? " bare" : ""}${page.panel === undefined ? "" : " has-panel"}`;

  return html`<!doctype html>
<html lang="en" data-theme="${look.theme?.chosen ?? "system"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${page.heading} - ${look.title}</title>
<style nonce="${look.nonce}">${raw(STYLE)}</style>${copyScript(look)}
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<div class="${classes}">
${side(page.tab, look)}
<main id="content">
${demoLine(look)}<div class="title">${heading(page)}${page.beside ?? html``}</div>
${tabList(page.tab, look.tabs)}
${page.body}
${page.panel?.body ?? html``}
</main>
</div>
${noticeLine(look)}
</body>
</html>`;
}
