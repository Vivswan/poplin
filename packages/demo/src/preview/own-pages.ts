// The preview's own markup: the gallery of every state, the page around a refusal in plain text, and the page that stands where the provider's login would be. None of it is a page of the product.

import { type Entry, GROUPS } from "./gallery";

/** The look of the preview's own pages. It follows the system's scheme. */
const STYLE = `
:root { color-scheme: light dark; --ink: light-dark(#1c1b19, #ecebe7); --soft: light-dark(#5f5c55, #a9a59b); --paper: light-dark(#faf9f6, #161614); }
:root { --card: light-dark(#ffffff, #1f1f1c); --line: light-dark(#dedbd3, #35342f); --mark: light-dark(#8a4b12, #e8a866); }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.5rem 1rem; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 72rem; margin: 0 auto; }
.home { margin: 0 0 1rem; color: var(--soft); font-size: 13px; }
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

/** The characters markup reads as its own, each with what stands for it. */
const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** What the gallery is drawn from. */
interface Gallery {
  /** Every link, in the order of its group. */
  readonly entries: readonly Entry[];

  /** The admin token of the seeded install. */
  readonly token: string;

  /** The origin the browser asked. */
  readonly origin: string;
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
 * Put the preview's frame around a page of its own.
 *
 * @param body - markup, already escaped
 * @returns the whole document, with the way to the dashboard above the page; it loads nothing from anywhere
 */
export function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escaped(title)} - poplin demo</title>
<style>${STYLE}</style>
</head>
<body><main><p class="home"><a href="/">Dashboard</a></p>${body}</main></body>
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
  );
}

/**
 * Build the page the preview shows around a refusal the product answers as plain text.
 *
 * @param text - the product's whole answer
 * @returns a page that says what the product answered and with which status
 */
export function plainPage(text: string, status: number): string {
  return shell(String(status), `<h1>${status}</h1><p class="banner">Demo. The product answers this request with the status ${status} and these words alone, as plain text:</p><pre>${escaped(text)}</pre>`);
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
