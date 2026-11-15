// A static host has no file for a page inside the demo, such as `/demo/settings`: only the demo's worker answers it.
// A visitor who opens such an address first, or reloads one around the worker, gets the host's 404 page. This script on that page sends them through the demo's first page.
//
//   /poplin/demo/settings?done=saved#content   ->   /poplin/demo/?to=%2Fsettings%3Fdone%3Dsaved#content

/** The `script` element that sends an address inside the demo to the demo's first page; on any other address it does nothing. */
function deepLinkScript(at: string): string {
  const demo = JSON.stringify(at);

  return `<script>if (location.pathname.startsWith(${demo})) location.replace(${demo} + "?to=" + encodeURIComponent("/" + location.pathname.slice(${at.length}) + location.search) + location.hash);</script>`;
}

/**
 * Write the 404 page of a host that serves the demo.
 *
 * @param at - the path the demo's folder is served at, with its closing slash, such as `/` or `/poplin/demo/`
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
