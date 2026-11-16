// The Worker's `ZONE` binding: where an install answers, as the OpenTofu module binds it and as setup stores it. It holds one of two values, and never both:
//
//   { domain, public_word? }    an install with a domain
//   { account_address }         an install without one, on the account's free address

import * as v from "valibot";
import { type AccountAddresses, type CheckedAccountAddresses, parseAccountAddresses } from "./address-layout";
import { type CheckedLayout, type DomainLayout, parseDomainLayout } from "./layout";

const SHAPE = v.strictObject({ domain: v.string(), public_word: v.optional(v.string()) });

const ADDRESS_SHAPE = v.strictObject({ account_address: v.string() });

/** The kind of an install with its layout: one with a domain, or one on the account's free address, whose three hosts the layout carries. */
export type BoundInstall = { readonly kind: "domain"; readonly layout: DomainLayout } | { readonly kind: "account address"; readonly layout: AccountAddresses };

/** The install a binding names, or why it names none: `absent` for a Worker with no such binding, `bad-shape` for anything but one of the two values, else the rule a value breaks. */
type ReadInstall =
  | { readonly ok: true; readonly value: BoundInstall }
  | { readonly ok: false; readonly refusal: "absent" | "bad-shape" | Extract<CheckedLayout | CheckedAccountAddresses, { readonly ok: false }>["refusal"] };

/**
 * Read which kind of install the `ZONE` binding names.
 *
 * @param binding - the binding as the runtime hands it over, of any type; `undefined` for a Worker with none
 * @param worker - the Worker's own name, which the hosts of an install without a domain are made from
 * @returns the kind with its layout, or a refusal the Worker can show; a value that holds both a domain and an account's address, or neither, a key beyond its kind's own, or one that is no text is `bad-shape`, and nothing throws
 */
export function readInstallBinding(binding: unknown, worker: string): ReadInstall {
  if (binding === undefined) return { ok: false, refusal: "absent" };

  const address = v.safeParse(ADDRESS_SHAPE, binding);
  if (address.success) {
    const layout = parseAccountAddresses(address.output, worker);

    return layout.ok ? { ok: true, value: { kind: "account address", layout: layout.value } } : layout;
  }

  const shaped = v.safeParse(SHAPE, binding);
  if (!shaped.success) return { ok: false, refusal: "bad-shape" };

  const layout = parseDomainLayout(shaped.output);

  return layout.ok ? { ok: true, value: { kind: "domain", layout: layout.value } } : layout;
}
