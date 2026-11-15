// The media type a `Content-Type` header names: what a body is checked by, whichever side reads it.

/**
 * Read the media type of a `Content-Type` header.
 *
 * @param header - the header's value, or `null` for a message without one
 * @returns the type without its parameters, in lowercase, such as `text/plain`; empty for no header
 */
export function mediaTypeOf(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}
