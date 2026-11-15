// The console's one page: it links the client's stylesheet and script and carries what the client starts from. Beside it, how a host hands the client's built files out.

import type { Update } from "@poplin/core/src/actions/update";
import { html, raw } from "hono/html";

/** The characters that would end the data block, each as JSON's own escape. */
const UNSAFE: Readonly<Record<string, string>> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" };

/** How long a browser may keep a file of the client: for good, as a build puts a hash of the content into the file's name. */
export const KEPT_FOR_GOOD = "public, max-age=31536000, immutable";

/** The names of the two files the page loads, as the client's build named them. */
interface Entry {
  readonly script: string;
  readonly style: string;
}

/** The client's built files, as a host hands them out. */
export interface ClientFiles {
  /** Names the script and the stylesheet the page loads, asked for every page: a host that builds the client anew names them anew. */
  readonly entry: () => Promise<Entry>;

  /** Reads one built file by its name, such as `app-4f1c.js`; `undefined` for a name the build did not write. */
  readonly file: (name: string) => Promise<{ readonly body: string | Uint8Array<ArrayBuffer>; readonly type: string } | undefined>;
}

/** What the client starts from: the server writes it into the page and the client reads it back as this. Nothing in it is a secret. */
export interface Boot {
  /** The path every route of the console starts with. */
  readonly base: string;

  /** Who is logged in. */
  readonly email: string;

  /** The install's title. */
  readonly title: string;

  /** The version the install runs. */
  readonly version: string;

  /** The newer release the install knows of, or `null`. */
  readonly update: Update | null;

  /** Whether an update can be started from the frame. */
  readonly starts: boolean;

  /** Set when the data is a sample that a POST to `reset` starts over. */
  readonly demo: { readonly reset: string } | null;

  /** Whether the console has a Domain screen. */
  readonly domain: boolean;

  /** What the domain needs, as the side shows it, or `null`. */
  readonly domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null;

  /** What the setup screen starts from, on the page shown before anyone has logged in; left out on every other. */
  readonly setup?: unknown;
}

/**
 * Build the shell page.
 *
 * @param entry - the names of the script and the stylesheet, as the client's build named them
 * @returns a whole HTML document. The start values sit in a data block the browser does not run, and every address is under the console's base path
 */
export function shellPage(boot: Boot, entry: Entry): ReturnType<typeof html> {
  // JSON is written into the block as it is, with only what could end the block escaped in JSON's own way.
  const start = raw(JSON.stringify(boot).replace(/[<>&]/g, (character) => UNSAFE[character] ?? character));

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${boot.title}</title>
<link rel="stylesheet" href="${boot.base}/assets/${entry.style}">
<script type="application/json" id="boot">${start}</script>
<script type="module" src="${boot.base}/assets/${entry.script}"></script>
</head>
<body>
<div id="root"></div>
<noscript>The dashboard needs JavaScript.</noscript>
</body>
</html>
`;
}
