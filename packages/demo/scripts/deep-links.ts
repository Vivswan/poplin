// A static host has no file for a page inside the demo, such as `/demo/settings`: only the demo's worker answers it.
// A visitor who opens such an address first, or reloads one around the worker, gets the host's 404 page. This script on that page sends them through the demo's first page.
//
//   /poplin/demo/settings?done=saved#content   ->   /poplin/demo/?to=%2Fsettings%3Fdone%3Dsaved#content

/** The end of a page's head, where the script goes. */
const HEAD_END = "</head>";

/** The `script` element that sends an address inside the demo to the demo's first page; on any other address it does nothing. */
function deepLinkScript(at: string): string {
  const demo = JSON.stringify(at);

  return `<script>if (location.pathname.startsWith(${demo})) location.replace(${demo} + "?to=" + encodeURIComponent("/" + location.pathname.slice(${at.length}) + location.search) + location.hash);</script>`;
}

/**
 * Put the script into a host's own 404 page.
 *
 * @param page - the whole page
 * @param at - the path the demo's folder is served at, with its closing slash, such as `/poplin/demo/`
 * @returns the page with the script at the end of its head
 * @throws {Error} the page has no head to put it in
 */
export function withDeepLinks(page: string, at: string): string {
  const end = page.indexOf(HEAD_END);
  if (end === -1) throw new Error("the 404 page has no </head> to put the demo's deep-link script before");

  return `${page.slice(0, end)}${deepLinkScript(at)}${page.slice(end)}`;
}

/**
 * Write a whole 404 page for a host that serves nothing but the demo.
 *
 * @param at - the path the demo's folder is served at, with its closing slash
 * @returns a page that sends an address inside the demo on, and says "Not found" for any other
 */
export function notFoundPage(at: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Not found - poplin demo</title>
${deepLinkScript(at)}
</head>
<body><p>Not found.</p></body>
</html>
`;
}
