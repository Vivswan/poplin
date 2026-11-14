// The Worker's `ZONE` binding: the zone values of an install with a domain, as the OpenTofu module binds them and as setup stores them.

import * as v from "valibot";
import { type CheckedLayout, parseDomainLayout } from "./layout";

const SHAPE = v.strictObject({ domain: v.string(), admin_hostname: v.string(), suffix: v.string() });

/** The layout a binding holds, or why it holds none: `absent` for a Worker with no such binding, `bad-shape` for anything but the three texts, else the rule a value breaks. */
type ReadZone = CheckedLayout | { readonly ok: false; readonly refusal: "absent" | "bad-shape" };

/**
 * Read the `ZONE` binding.
 *
 * @param binding - the binding as the runtime hands it over, of any type; `undefined` for a Worker bound to no zone
 * @returns the layout, or a refusal the Worker can show; a value with a key missing, a key beyond the three, or one that is no text is `bad-shape`, and nothing throws
 */
export function readZoneBinding(binding: unknown): ReadZone {
  if (binding === undefined) return { ok: false, refusal: "absent" };

  const shaped = v.safeParse(SHAPE, binding);
  if (!shaped.success) return { ok: false, refusal: "bad-shape" };

  return parseDomainLayout(shaped.output);
}
