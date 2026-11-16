// An address a link may lead to, as the server or the host gave it.

/**
 * Read an address a link may lead to: a whole one that starts with https.
 *
 * @returns the address as a link holds it; `undefined` for anything else, so no text that reaches the page is run by a press
 */
export function httpsLink(address: string): string | undefined {
  if (!URL.canParse(address)) return undefined;

  const parsed = new URL(address);

  return parsed.protocol === "https:" ? parsed.href : undefined;
}
