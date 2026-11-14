// A request to any hostname but the admin one: its login checked, looked up, counted against the limits, then served.
//
//   the address  ->  under `p`: the Access token and the logins  ->  one database query  ->  the limits  ->  serving, handed the site already found
//
// Access stands in front of every `p` address at the edge. The token it puts on a request is checked here all the same, and the email against the logins of the last minute.
// A request under `p` without that proof came around Access: it is looked up nowhere.
// Only a request the site's files are read for counts against the site. Every other counts against its visitor's minute alone, so the limits tell nobody whether a private id exists.
// Serving's answer goes out as it is. Nothing here reads, holds, or changes a file's bytes.

import { checkLimits, type Counters, type Refusal } from "@poplin/app/src/limits/limits";
import { refusalResponse } from "@poplin/app/src/limits/refusal";
import { type VisitorKey, visitorKey } from "@poplin/app/src/limits/visitor-key";
import { serveSite } from "@poplin/app/src/sites/serve";
import { isLogin } from "@poplin/core/src/auth/logins";
import type { Address } from "@poplin/core/src/database/database";
import type { Site } from "@poplin/core/src/records/site";
import { clientAddress } from "../limits/client-address";
import type { Held } from "./held";
import type { Instance } from "./start";
import { plain } from "./util";

/** A request the limits let through. */
const ALLOWED = { ok: true } as const;

/** A request no login was asked of: its address is not under `p`. */
const NOT_ASKED = { kind: "not-asked" } as const;

/** What a request's URL addresses, as the install's layout reads it. */
type Addressed = ReturnType<Instance["addresses"]["resolve"]>;

/** What the login says of a request under `p`. `unchecked` is a token that cannot be checked now, because the team's keys cannot be had. */
type Proof = typeof NOT_ASKED | { readonly kind: "vouched" } | { readonly kind: "refused" } | { readonly kind: "unchecked" };

/** The one query that finds the site an address serves; none for an address that names no site. */
function queryOf(addressed: Addressed): Address | undefined {
  if (addressed.kind === "site") return { id: addressed.id };

  if (addressed.kind === "public-name") return { public_name: addressed.name };

  return undefined;
}

/** Decide whether an address is the one a site's files go out at: `p` for a private site, any other letter or none for the rest. Serving sends every other label address elsewhere. */
function opensAt(addressed: Addressed, site: Site): boolean {
  if (addressed.kind !== "site") return true;

  return (addressed.letter === "p") === (site.access === "private");
}

function sameAddress(one: Address, other: Address | undefined): boolean {
  return other !== undefined && JSON.stringify(one) === JSON.stringify(other);
}

/** Check the Access token of a request under `p`, and its email against the logins. Every refusal is logged by its kind, never with a value of the request. */
async function proofOf(request: Request, addressed: Addressed, context: { readonly instance: Instance; readonly held: Held; readonly now: number }): Promise<Proof> {
  if (addressed.kind !== "site" || addressed.letter !== "p") return NOT_ASKED;

  const identity = await context.instance.identify(request.headers, context.now);
  if (identity.ok && isLogin(context.held.logins, identity.value)) return { kind: "vouched" };

  const refusal = identity.ok ? "not-a-login" : identity.refusal;
  console.warn(`poplin: a request for a private site was refused: ${refusal}`);

  return refusal === "keys-unavailable" ? { kind: "unchecked" } : { kind: "refused" };
}

/** Count a request for no served site against its visitor's minute. A counter that cannot answer lets it through, as the limits do. */
async function takeVisitorMinute(counters: Counters, window: { readonly key: VisitorKey; readonly limit: number }, now: number): Promise<typeof ALLOWED | Refusal> {
  try {
    const taken = await counters.takeMinute({ scope: "visitor", ...window }, now);
    if (taken.ok) return ALLOWED;

    return { ok: false, which: "visitor", retryAfterSeconds: taken.retryAfterSeconds };
  } catch {
    return ALLOWED;
  }
}

/**
 * Answer a visitor's request.
 *
 * @returns 429 with `Retry-After` from the first limit that refuses, 503 for a request under `p` while the team's keys cannot be had, and otherwise serving's own response, untouched
 * @throws whatever the database or the bucket rejects with
 */
export async function answerSite(request: Request, instance: Instance, held: Held): Promise<Response> {
  const { database, store } = instance.install;
  const now = instance.install.now();
  const addressed = instance.addresses.resolve(new URL(request.url));
  const proof = await proofOf(request, addressed, { instance, held, now });
  const cameAround = proof.kind === "refused" || proof.kind === "unchecked";
  const address = cameAround ? undefined : queryOf(addressed);
  const site = address === undefined ? undefined : await database.findServed(address, now);

  const visitor = await visitorKey(clientAddress(request.headers), held.visitorSecret, now);
  const verdict =
    site === undefined || !opensAt(addressed, site)
      ? await takeVisitorMinute(instance.counters, { key: visitor, limit: held.settings.visitor_requests_per_minute }, now)
      : await checkLimits({ settings: held.settings, site: site.id, visitor, now }, instance.counters);
  if (!verdict.ok) return refusalResponse(verdict);

  if (proof.kind === "unchecked") return plain(request, 503, "The login cannot be checked right now. Try again.", { "Retry-After": "60" });

  return serveSite(request, {
    // Serving asks for the site of the same address: it is answered from the query above, so a page view costs one.
    database: { findServed: async (again, at) => (sameAddress(again, address) ? site : database.findServed(again, at)) },
    store,
    settings: held.settings,
    addresses: instance.addresses,
    // Serving asks only under `p`, where the proof above is the answer.
    identify: async () => ({ ok: proof.kind === "vouched" }),
    now: () => now,
  });
}
