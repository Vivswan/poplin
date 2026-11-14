// A request to any hostname but the admin one: looked up, counted against the limits, then served.
//
//   the address  ->  one database query  ->  the limits  ->  serving, handed the site already found
//
// A request that names no served site counts against its visitor's minute alone: there is no site to count it for.
// Serving's answer goes out as it is. Nothing here reads, holds, or changes a file's bytes.

import { checkLimits, type Counters, type Refusal } from "@poplin/app/src/limits/limits";
import { refusalResponse } from "@poplin/app/src/limits/refusal";
import { type VisitorKey, visitorKey } from "@poplin/app/src/limits/visitor-key";
import { readSession } from "@poplin/app/src/login/session";
import { serveSite } from "@poplin/app/src/sites/serve";
import type { Address } from "@poplin/core/src/database/database";
import { clientAddress } from "../limits/client-address";
import type { Held } from "./held";
import type { Instance } from "./start";

/** A request the limits let through. */
const ALLOWED = { ok: true } as const;

/** What a request's URL addresses, as the install's layout reads it. */
type Addressed = ReturnType<Instance["addresses"]["resolve"]>;

/** The one query that finds the site an address serves; none for an address that names no site. */
function queryOf(addressed: Addressed): Address | undefined {
  if (addressed.kind === "site") return { id: addressed.id };

  if (addressed.kind === "public-name") return { public_name: addressed.name };

  return undefined;
}

function sameAddress(one: Address, other: Address | undefined): boolean {
  return other !== undefined && JSON.stringify(one) === JSON.stringify(other);
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
 * @returns 429 with `Retry-After` from the first limit that refuses, and otherwise serving's own response, untouched
 * @throws whatever the database or the bucket rejects with
 */
export async function answerSite(request: Request, instance: Instance, held: Held): Promise<Response> {
  const { database, store } = instance.install;
  const now = instance.install.now();
  const addressed = instance.addresses.resolve(new URL(request.url));
  const address = queryOf(addressed);
  const site = address === undefined ? undefined : await database.findServed(address, now);

  const visitor = await visitorKey(clientAddress(request.headers), held.visitorSecret, now);
  const verdict =
    site === undefined
      ? await takeVisitorMinute(instance.counters, { key: visitor, limit: held.settings.visitor_requests_per_minute }, now)
      : await checkLimits({ settings: held.settings, site: site.id, visitor, now }, instance.counters);
  if (!verdict.ok) return refusalResponse(verdict);

  return serveSite(request, {
    // Serving asks for the site of the same address: it is answered from the query above, so a page view costs one.
    database: { findServed: async (again, at) => (sameAddress(again, address) ? site : database.findServed(again, at)) },
    store,
    settings: held.settings,
    addresses: instance.addresses,
    readSession: (headers) => readSession(headers, { key: held.sessionKey, logins: held.logins, now }),
    now: () => now,
  });
}
