// The entry's own answers: the ones no piece of the product gives, such as an install that could not start.

/** The headers of every such answer: never cached, never indexed, never framed. */
const PLAIN_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Content-Type": "text/plain; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
} as const;

/**
 * Build a small plain-text answer.
 *
 * @param text - the whole body; a `HEAD` request gets the headers alone
 * @param extra - headers beside the plain ones, such as `Allow`
 */
export function plain(request: Request, status: number, text: string, extra: Readonly<Record<string, string>> = {}): Response {
  const headers = { ...PLAIN_HEADERS, ...extra };
  if (request.method === "HEAD") return new Response(null, { status, headers });

  return new Response(`${text}\n`, { status, headers });
}
