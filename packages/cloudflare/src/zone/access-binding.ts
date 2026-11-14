// The Worker's `ACCESS` binding: the Access application in front of the login path, as the OpenTofu module binds it.

import { parseHostname } from "@poplin/core/src/names/hostname";
import * as v from "valibot";

/** The two texts the binding holds, and no other key. */
const SHAPE = v.strictObject({ team_domain: v.string(), audience: v.string() });

/** An application's audience tag as Access writes it: 64 lowercase hexadecimal characters. */
const AUDIENCE = /^[0-9a-f]{64}$/;

/** The application a binding names. `teamDomain` is `https://<team>.cloudflareaccess.com`, the issuer of the team's tokens, with no trailing slash. */
interface BoundAccess {
  readonly teamDomain: string;
  readonly audience: string;
}

/** The application, or why the binding names none: `absent` for a Worker with no such binding, `bad-shape` for anything but the two texts, else the value that is wrong. */
type ReadAccess = { readonly ok: true; readonly value: BoundAccess } | { readonly ok: false; readonly refusal: "absent" | "bad-shape" | "bad-team-domain" | "bad-audience" };

/**
 * Read the `ACCESS` binding.
 *
 * @param binding - the binding as the runtime hands it over, of any type; `team_domain` is the team's hostname alone, such as `team.cloudflareaccess.com`
 * @returns the application, or a refusal the Worker can show; nothing throws
 */
export function readAccessBinding(binding: unknown): ReadAccess {
  if (binding === undefined) return { ok: false, refusal: "absent" };

  const shaped = v.safeParse(SHAPE, binding);
  if (!shaped.success) return { ok: false, refusal: "bad-shape" };

  const team = parseHostname(shaped.output.team_domain);
  if (!team.ok) return { ok: false, refusal: "bad-team-domain" };

  if (!AUDIENCE.test(shaped.output.audience)) return { ok: false, refusal: "bad-audience" };

  return { ok: true, value: { teamDomain: `https://${team.value}`, audience: shaped.output.audience } };
}
