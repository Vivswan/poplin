// A posted form, read: one content type, and the fields by name.

import * as v from "valibot";

import type { Form } from "../records";

/** The one content type a dashboard form is sent in. */
const FORM_TYPE = "application/x-www-form-urlencoded";

/**
 * Decide whether a request says it carries a form.
 *
 * @returns `true` for the URL-encoded type, with or without parameters, in any capitals
 */
export function isForm(request: Pick<Request, "headers">): boolean {
  const [type = ""] = (request.headers.get("Content-Type") ?? "").split(";");

  return type.trim().toLowerCase() === FORM_TYPE;
}

/**
 * Read the fields of a URL-encoded body.
 *
 * @param body - the body as text; any text is taken
 * @returns every field by name; of a name sent twice the last value
 */
export function readForm(body: string): Form {
  return new Map(new URLSearchParams(body));
}

/**
 * Take the named fields out of a form.
 *
 * @returns the value of each name as it was sent, or `undefined` when one of them was not sent; every other field is ignored
 */
export function requireFields<Name extends string>(form: Form, names: readonly Name[]): Record<Name, string> | undefined {
  const taken = v.safeParse(v.object(v.entriesFromList(names, v.string())), Object.fromEntries(form));
  if (!taken.success) return undefined;

  return taken.output;
}
