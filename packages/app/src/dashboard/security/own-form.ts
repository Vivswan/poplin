// A posted form that a page of this origin sent: the three checks every form passes before any of it is used.

import type { Form } from "../records";
import { checkCsrfToken } from "./csrf";
import { isForm, readForm } from "./form";
import { isSameOrigin } from "./same-origin";

/** The form, or the refusal code and status of the first check it failed. */
type OwnForm = { readonly ok: true; readonly form: Form } | { readonly ok: false; readonly code: "not_a_form" | "not_from_here"; readonly status: 415 | 403 };

/**
 * Read a posted form, only when it is one, comes from this origin, and carries a token made for the same binding.
 *
 * @param binding - the key, the name, and the time the form's `csrf` field is checked against
 * @returns the fields, or the refusal; the body is read only after the content type and the origin pass
 */
export async function readOwnForm(request: Request, binding: Parameters<typeof checkCsrfToken>[1]): Promise<OwnForm> {
  if (!isForm(request)) return { ok: false, code: "not_a_form", status: 415 };

  if (!isSameOrigin(request)) return { ok: false, code: "not_from_here", status: 403 };

  // Read as bytes: the Workers runtime logs a warning on every `text()` of a body whose type is not text.
  const form = readForm(new TextDecoder().decode(await request.arrayBuffer()));
  if (!(await checkCsrfToken(form.get("csrf") ?? "", binding))) return { ok: false, code: "not_from_here", status: 403 };

  return { ok: true, form };
}
