// The console's one page: it links poplin's icon and the client's stylesheet and script, and carries what the client starts from. Beside it, how a host hands the client's built files out.

import type { WayBack } from "@poplin/core/src/actions/go-back";
import type { Update } from "@poplin/core/src/actions/update";
import { html, raw } from "hono/html";

import { DEFAULT_ICON, DEFAULT_ICON_TYPE } from "../sites/default-icon";
import type { Marked } from "./problems-routes";

/** The characters that would end the data block, each as JSON's own escape. */
const UNSAFE: Readonly<Record<string, string>> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" };

/** How long a browser may keep a file of the client: for good, as a build puts a hash of the content into the file's name. */
export const KEPT_FOR_GOOD = "public, max-age=31536000, immutable";

/** The name the console's icon is asked for under. It holds the start of a hash of the icon's content, as a file of the client does, so a browser may keep it for good. */
export const ICON_FILE = "icon-ed1e2ec2.svg";

/** How long a browser may keep the answer to `/favicon.ico`, the name it asks for unbidden: a day, as that name holds no hash. */
export const KEPT_A_DAY = "public, max-age=86400";

/** The console's icon as a file. */
export const ICON = { body: DEFAULT_ICON, type: DEFAULT_ICON_TYPE } as const;

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

  /** The page's title. */
  readonly title: string;

  /** The version the install runs. */
  readonly version: string;

  /** The newer release the install knows of, or `null`. */
  readonly update: Update | null;

  /** Whether an update can be started from the frame. */
  readonly starts: boolean;

  /** The version the install can go back to and since when it runs the one it would leave, or `null`. */
  readonly back: WayBack | null;

  /** Set when the data is a sample that a POST to `reset` starts over. */
  readonly demo: { readonly reset: string } | null;

  /** Whether the console has a Domain screen. */
  readonly domain: boolean;

  /** The address that ends this browser's login, or `null` on a console that is told none. */
  readonly signOut: string | null;

  /** What the domain needs, as the side shows it, or `null`. */
  readonly domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null;

  /** The problems last seen within a day, the newest first. */
  readonly recent: Marked["recent"];

  /** What the side marks at each screen that holds a problem. */
  readonly marks: Marked["marks"];

  /** What the setup screen starts from, on the setup page; left out on every other. */
  readonly setup?: unknown;
}

/**
 * Read one file a page of the console loads.
 *
 * @param name - the file's name under `assets/`, such as `app-4f1c.js`
 * @returns the console's own icon under its name, a file of the client's build under any other, or `undefined` for a name that is neither
 */
export async function assetOf(client: ClientFiles, name: string): ReturnType<ClientFiles["file"]> {
  return name === ICON_FILE ? ICON : client.file(name);
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
<link rel="icon" type="${DEFAULT_ICON_TYPE}" href="${boot.base}/assets/${ICON_FILE}">
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
