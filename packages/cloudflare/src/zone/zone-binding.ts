// The Worker's `ZONE` binding: where an install answers, as the OpenTofu module binds it and as setup stores it. It holds one of two values, and never both:
//
//   { domain, public_word? }    an install with a domain
//   { account_address }         an install without one, on the account's free address

import * as v from "valibot";
import { type AddressLayout, type CheckedAddressLayout, parseAddressLayout } from "./address-layout";
import { type CheckedLayout, type DomainLayout, parseDomainLayout } from "./layout";

const SHAPE = v.strictObject({ domain: v.string(), public_word: v.optional(v.string()) });

const ADDRESS_SHAPE = v.strictObject({ account_address: v.string() });

/** The layout a binding holds, or why it holds none: `absent` for a Worker with no such binding, `bad-shape` for anything but the domain and the public word as texts, else the rule a value breaks. */
type ReadZone = CheckedLayout | { readonly ok: false; readonly refusal: "absent" | "bad-shape" };

/** The kind of an install with its layout: one with a domain, or one on the account's free address, whose three hosts the layout carries. */
export type BoundInstall = { readonly kind: "domain"; readonly layout: DomainLayout } | { readonly kind: "account address"; readonly layout: AddressLayout };

/** The install a binding names, or why it names none: `absent` for a Worker with no such binding, `bad-shape` for anything but one of the two values, else the rule a value breaks. */
type ReadInstall =
  | { readonly ok: true; readonly value: BoundInstall }
  | { readonly ok: false; readonly refusal: "absent" | "bad-shape" | Extract<CheckedLayout | CheckedAddressLayout, { readonly ok: false }>["refusal"] };

/**
 * Read the `ZONE` binding.
 *
 * @param binding - the binding as the runtime hands it over, of any type; `undefined` for a Worker bound to no zone
 * @returns the layout, or a refusal the Worker can show; a value with no domain, a key beyond the two, or one that is no text is `bad-shape`, and nothing throws
 */
export function readZoneBinding(binding: unknown): ReadZone {
  if (binding === undefined) return { ok: false, refusal: "absent" };

  const shaped = v.safeParse(SHAPE, binding);
  if (!shaped.success) return { ok: false, refusal: "bad-shape" };

  return parseDomainLayout(shaped.output);
}

/**
 * Read which kind of install the `ZONE` binding names.
 *
 * @param binding - the binding as the runtime hands it over, of any type; `undefined` for a Worker with none
 * @param worker - the Worker's own name, which the hosts of an install without a domain are made from
 * @returns the kind with its layout, or a refusal the Worker can show; a value that holds both a domain and an account's address, or neither, is `bad-shape`, and nothing throws
 */
export function readInstallBinding(binding: unknown, worker: string): ReadInstall {
  if (binding === undefined) return { ok: false, refusal: "absent" };

  const address = v.safeParse(ADDRESS_SHAPE, binding);
  if (address.success) {
    const layout = parseAddressLayout(address.output, worker);

    return layout.ok ? { ok: true, value: { kind: "account address", layout: layout.value } } : layout;
  }

  const layout = readZoneBinding(binding);

  return layout.ok ? { ok: true, value: { kind: "domain", layout: layout.value } } : layout;
}
