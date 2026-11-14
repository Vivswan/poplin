// The preview's own markup: the bar under every page, the gallery of every state, and the page that stands where the provider's login would be. None of it is a page of the product.

import { type Entry, GROUPS } from "./gallery";
import { NONCE_SLOT } from "./mount";

/** The look of the preview's own pages. It follows the system's scheme unless one is forced. */
const STYLE = `
:root { color-scheme: light dark; --ink: light-dark(#1c1b19, #ecebe7); --soft: light-dark(#5f5c55, #a9a59b); --paper: light-dark(#faf9f6, #161614); }
:root { --card: light-dark(#ffffff, #1f1f1c); --line: light-dark(#dedbd3, #35342f); --mark: light-dark(#8a4b12, #e8a866); }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.5rem 1rem 4rem; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 72rem; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
h2 { font-size: 0.95rem; margin: 0 0 0.5rem; }
a { color: inherit; text-underline-offset: 0.15em; }
a:hover { color: var(--mark); }
code, pre { font: 13px/1.5 ui-monospace, monospace; }
pre { margin: 0.5rem 0 0; padding: 0.6rem 0.75rem; overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
.banner { margin: 0.75rem 0; padding: 0.6rem 0.75rem; border-left: 4px solid var(--mark); background: var(--card); }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); gap: 0.75rem; margin-top: 1.25rem; }
section { padding: 0.75rem 0.9rem; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
ul { margin: 0; padding: 0; list-style: none; }
li { padding: 0.15rem 0; overflow-wrap: anywhere; }
.status { margin-left: 0.35rem; padding: 0 0.35rem; border: 1px solid var(--line); border-radius: 999px; color: var(--soft); font-size: 12px; }
`;

/** The look of the bar: small and neutral, its own colours and sizes whatever page it sits under, and room for it below that page. */
const BAR_STYLE = `
body { padding-bottom: 2.25rem !important; }
#preview-bar { all: initial; position: fixed; z-index: 2147483647; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.9rem; }
#preview-bar { padding: 0.2rem 0.75rem; background: #222220; color: #b9b5ac; font: 11px/1.6 system-ui, sans-serif; }
#preview-bar * { all: unset; }
#preview-bar a, #preview-bar button { color: #f2f0ea; text-decoration: underline; text-underline-offset: 0.15em; cursor: pointer; }
#preview-bar a:focus-visible, #preview-bar button:focus-visible { outline: 2px solid #f2f0ea; outline-offset: 2px; }
#preview-bar [aria-current] { color: #b9b5ac; text-decoration: none; }
#preview-bar form { display: inline; }
#preview-bar .end { margin-left: auto; display: flex; gap: 0 0.9rem; }
`;

/** The schemes the bar switches between; the first follows the system. */
const THEMES = ["system", "light", "dark"] as const;

/** The characters markup reads as its own, each with what stands for it. */
const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** What the bar is drawn from. */
interface Bar {
  /** The scheme every page is forced to; the system's own when absent. */
  readonly theme: "light" | "dark" | undefined;

  /** The path and query of the page the bar sits under, where a change of scheme comes back to. */
  readonly here: string;

  /** The places this page leads on to that the product itself has no link for, each with its words. */
  readonly hints: readonly (readonly [words: string, path: string])[];
}

/** What the gallery is drawn from. */
interface Gallery {
  /** Every link, in the order of its group. */
  readonly entries: readonly Entry[];

  /** The admin token of the seeded install. */
  readonly token: string;

  /** The origin the browser asked. */
  readonly origin: string;

  /** The bar under the page. */
  readonly bar: string;
}

function escaped(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

function entryItem(entry: Entry): string {
  const status = entry.status === undefined ? "" : `<span class="status">${entry.status}</span>`;

  return `<li><a href="${escaped(entry.path)}">${escaped(entry.name)}</a>${status}</li>`;
}

function groupSection(group: string, entries: readonly Entry[]): string {
  return `<section><h2>${escaped(group)}</h2><ul>${entries.map(entryItem).join("")}</ul></section>`;
}

/**
 * Build the bar that sits under every page of the demo.
 *
 * @returns markup for the end of a page's body: what the demo is, the way home, the page's hints, the scheme switch, and the reset. Its style element carries `NONCE_SLOT` for the page's nonce
 */
export function previewBar(bar: Bar): string {
  const back = encodeURIComponent(bar.here);
  const hints = bar.hints.map(([words, path]) => `<a href="${escaped(path)}">${escaped(words)}</a>`);
  const themes = THEMES.map((theme) => `<a href="/theme/${theme}?to=${back}"${theme === (bar.theme ?? "system") ? ' aria-current="true"' : ""}>${theme}</a>`);

  return `<style nonce="${NONCE_SLOT}">${BAR_STYLE}</style>
<nav id="preview-bar" aria-label="Demo"><span>Demo: sample data, resets</span><a href="/">Dashboard</a>${hints.join("")}
<span class="end"><span>${themes.join(" ")}</span><form method="post" action="/reset"><button type="submit">Reset</button></form></span></nav>`;
}

/**
 * Put the preview's frame around a page of its own.
 *
 * @param body - markup, already escaped
 * @param bar - the bar's markup; a page the mount answers gets its bar there, and takes none here
 * @returns the whole document; it loads nothing from anywhere
 */
export function shell(title: string, body: string, bar = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escaped(title)} - poplin demo</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main>${bar.replaceAll(NONCE_SLOT, "")}</body>
</html>`;
}

/**
 * Build the gallery: the banner, how to reach the install from a terminal, and every link by its group.
 *
 * @returns the document; a link whose answer is no 200 carries the status it answers with
 */
export function galleryPage(gallery: Gallery): string {
  const groups = GROUPS.map((group) => groupSection(group, gallery.entries.filter((entry) => entry.group === group)));
  const login = `POPLIN_SERVER=${escaped(gallery.origin)} POPLIN_TOKEN=${escaped(gallery.token)}`;

  return shell(
    "Gallery",
    `<h1>Every page and every state</h1>
<p class="banner">Sample data, held in memory. Nothing leaves this machine. A restart, or a reset, starts it over. Every page is shown to the sample admin; a link marked "as a stranger" is not.</p>
<section><h2>The command line, the MCP server, and the API, as the sample admin</h2>
<pre># from the repository's folder; the token is the sample admin's
export ${login}
bun packages/cli/src/bin.ts list          # any command
bun packages/cli/src/bin.ts mcp           # the MCP server, over stdio
curl -H "Authorization: Bearer $POPLIN_TOKEN" $POPLIN_SERVER/api/sites

# or log a computer in, and allow it on the Tokens tab
bun packages/cli/src/bin.ts login --server ${escaped(gallery.origin)}</pre></section>
<div class="groups">${groups.join("")}</div>`,
    gallery.bar,
  );
}

/**
 * Build the page the preview shows around a refusal the product answers as plain text.
 *
 * @param text - the product's whole answer
 * @returns a page that says what the product answered and with which status, with the bar under it
 */
export function plainPage(text: string, status: number, bar: string): string {
  return shell(String(status), `<h1>${status}</h1><p class="banner">Demo. The product answers this request with the status ${status} and these words alone, as plain text:</p><pre>${escaped(text)}</pre>`, bar);
}

/**
 * Build the page that stands where the provider's login would be.
 *
 * @param address - the path and query of the login address that was asked, at the admin origin
 * @returns a page with the two outcomes of a login as links: in as the sample admin, or refused
 */
export function loginPage(address: string): string {
  const choice = (login: string): string => escaped(`${address}${address.includes("?") ? "&" : "?"}preview-login=${login}`);

  return shell(
    "Login",
    `<h1>The login would be here</h1>
<p class="banner">Demo. On a real install the provider's login page asks who you are at this point. The demo has none, so choose the outcome.</p>
<ul><li><a href="${choice("admin")}">Log in as the sample admin</a></li><li><a href="${choice("refused")}">Be refused</a><span class="status">403</span></li></ul>`,
  );
}
