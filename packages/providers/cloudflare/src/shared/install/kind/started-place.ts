// The Worker's `INSTALL_PLACE` binding: where an install was started for. Its first upload states it, before anything on the Worker says where it answers.
//
//   example.com    an install under that domain
//   none           an install without a domain
//
// Anything else is no place: the binding is a text whoever may write Workers in the account can set, so a domain in it is read as the `ZONE` binding of an install under it is read.
// It is read on a Worker that is not set alone: once `ZONE` is written, that says where the install answers.
// So a run that stopped half-way is gone on with, or removed, as the kind it was started as, and what it made under a domain is never left behind by a run of the other kind.

import type { SentBinding } from "../../release/update/upload";
import { INSTALL_OBJECTS } from "../install-objects";
import type { ListedBinding } from "../pieces/variables/variables";
import { readInstallBinding } from "./zone-binding";

/** What the binding holds for an install without a domain. */
const NONE = "none";

/** Where an install was started for: under a domain, by its name, or without one. */
type StartedPlace = { readonly kind: "domain"; readonly domain: string } | { readonly kind: "no-domain" };

/**
 * State where an install is started for, as its first upload sends it.
 *
 * @param place - the kind of the install, with the domain of one under a domain
 */
export function placeBinding(place: StartedPlace): SentBinding {
  return { name: INSTALL_OBJECTS.placeBinding, type: "plain_text", text: place.kind === "domain" ? place.domain : NONE };
}

/**
 * Read where the install of a Worker was started for.
 *
 * @param bindings - every binding of the Worker, as Cloudflare lists them
 * @returns the place; `undefined` for a Worker with no such binding, and for one whose text is neither `none` nor a domain an install can be under
 */
export function readStartedPlace(bindings: readonly ListedBinding[]): StartedPlace | undefined {
  const text = bindings.find((binding) => binding.name === INSTALL_OBJECTS.placeBinding && binding.type === "plain_text")?.text;
  if (typeof text !== "string") return undefined;

  if (text === NONE) return { kind: "no-domain" };

  const under = readInstallBinding({ domain: text }, INSTALL_OBJECTS.worker);

  return under.ok && under.value.kind === "domain" ? { kind: "domain", domain: under.value.layout.domain } : undefined;
}
