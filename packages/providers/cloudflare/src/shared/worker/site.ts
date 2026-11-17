// A request to any hostname but the admin one: its login checked, looked up, counted against the limits, then served.
//
//   the address  ->  the visitor's minute  ->  under `p`: the Access token and the logins  ->  one database query  ->  the site's limits  ->  serving, handed the site already found  ->  the day's count
//
// The visitor's minute is taken first, by the settings the instance read within the minute, so a visitor past it is refused with nothing read: neither a site nor a setting.
// Once that minute ran out, one request takes it after its query, which brings the settings anew: a limit that was raised is in force within the minute, however many requests are refused.
//
// The one query finds the site and reads beside it what the instance holds no longer: the settings once their minute ran out, and the site's count of the day once its half minute did.
// Under `p`, and at an address that names no site, the settings are read first and on their own: the login is checked before any site is looked up.
//
// Access stands in front of every `p` address at the edge. The token it puts on a request is checked here all the same, and the email against the users of the last minute.
// A request under `p` without that proof came around Access: it is looked up nowhere.
// Only a request the site's files are read for counts against the site. Every other counts against its visitor's minute alone, so the limits tell nobody whether a private id exists.
// The limits count the request against its day before it is served, and its one write comes after the answer, since only the answer says whether a page was opened.
// Serving's answer goes out as it is. Nothing here reads, holds, or changes a file's bytes.

import { checkSiteLimits, countRequest, isPageView, takeVisitorMinute } from "@poplin/app/src/limits/limits";
import { refusalResponse } from "@poplin/app/src/limits/refusal";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { admit } from "@poplin/app/src/login/admit";
import { serveSite } from "@poplin/app/src/sites/serve";
import { noteProblem } from "@poplin/core/src/actions/install/problems";
import type { Address, ServedLookup, ServedSite } from "@poplin/core/src/database/database";
import type { Site } from "@poplin/core/src/records/site";
import { dayOf } from "@poplin/core/src/records/views";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { clientAddress } from "../limits/client-address";
import type { Held, SiteHeld } from "./held";
import { type Instance, whyRefused } from "./start";
import { plain } from "./util";

/** A request the limits let through, counted against no site's day. */
const ALLOWED = { ok: true, requests: 0 } as const;

/** A request no login was asked of: its address is not under `p`. */
const NOT_ASKED = { kind: "not-asked" } as const;

/** How many public names an instance remembers the site of. A full memory is emptied, and each name is learned again at its next view. */
const MOST_NAMES_REMEMBERED = 1000;

/** What a request is answered from before its limits: the settings its instance holds, what the login said, and the site its address serves, with the address it was found by. */
interface Entered {
  readonly held: Held;
  readonly proof: Proof;
  readonly address: Address | undefined;
  readonly found: ServedSite | undefined;
}

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

/** The id of the site an address names: its own, or the one its public name last served on this instance. */
function idOf(addressed: Addressed, instance: Instance): SiteId | undefined {
  if (addressed.kind === "site") return addressed.id;

  return addressed.kind === "public-name" ? instance.servedByName.get(addressed.name) : undefined;
}

/**
 * Find the site an address serves, and in the same query read what the instance holds no longer: the settings and the key when `settingsAndKey` asks, and the day's count of the site.
 * The count goes to the counters only for the site the lookup found.
 */
async function lookUp(address: Address, addressed: Addressed, context: { readonly instance: Instance; readonly settingsAndKey: boolean; readonly now: number }): Promise<ServedLookup> {
  const { instance, settingsAndKey, now } = context;
  const id = idOf(addressed, instance);
  const window = id === undefined ? undefined : { day: dayOf(now), site: id };
  const counts = window !== undefined && !instance.counters.isDayFresh(window, now) ? { counts: window } : {};
  const looked = await instance.install.database.findServedWith(address, now, { ...counts, settingsAndKey });
  const found = looked.served?.site.id;
  if (window !== undefined && looked.counts !== undefined && found === window.site) instance.counters.learnDay(window, looked.counts, now);

  if (addressed.kind !== "public-name" || found === undefined) return looked;

  if (instance.servedByName.size >= MOST_NAMES_REMEMBERED) instance.servedByName.clear();
  instance.servedByName.set(addressed.name, found);

  return looked;
}

/**
 * Read what a request is answered from: the settings, the login's word on a request under `p`, and the site.
 * A request the login refused is looked up nowhere. Any other finds its site in one query, which also brings the settings when the instance's minute ran out.
 */
async function enter(request: Request, addressed: Addressed, context: { readonly instance: Instance; readonly holding: SiteHeld; readonly now: number }): Promise<Entered> {
  const { instance, holding, now } = context;
  const asked = queryOf(addressed);
  const underP = addressed.kind === "site" && addressed.letter === "p";
  const early = await (holding.current() ?? (underP || asked === undefined ? holding.read() : undefined));
  const proof = early === undefined ? NOT_ASKED : await proofOf(request, addressed, { instance, held: early, now });
  const address = proof.kind === "refused" || proof.kind === "unchecked" ? undefined : asked;
  const lookup = address === undefined ? undefined : lookUp(address, addressed, { instance, settingsAndKey: early === undefined, now });
  const held = early ?? (await (lookup === undefined ? holding.read() : holding.fromLookup(lookup.then((looked) => looked.settingsAndKey), now)));

  return { held, proof, address, found: (await lookup)?.served };
}

function sameAddress(one: Address, other: Address | undefined): boolean {
  return other !== undefined && JSON.stringify(one) === JSON.stringify(other);
}

/** Check the Access token of a request under `p`, and its email against the logins. Every refusal is logged by its kind, never with a value of the request. */
async function proofOf(request: Request, addressed: Addressed, context: { readonly instance: Instance; readonly held: Held; readonly now: number }): Promise<Proof> {
  if (addressed.kind !== "site" || addressed.letter !== "p") return NOT_ASKED;

  const who = await admit(request.headers, { identify: context.instance.identify, logins: context.held.logins, now: context.now });
  if (who.ok) return { kind: "vouched" };

  console.warn(`poplin: a request for a private site was refused: ${who.refusal}`);

  return whyRefused(who.refusal) === "unchecked" ? { kind: "unchecked" } : { kind: "refused" };
}

/** Count a request against its visitor's minute, by the visitor limit and the secret of what the instance holds. */
async function visitorMinute(request: Request, instance: Instance, held: Held, now: number): ReturnType<typeof takeVisitorMinute> {
  const visitor = await visitorKey(clientAddress(request.headers), held.visitorSecret, now);

  return takeVisitorMinute({ settings: held.settings, visitor, now }, instance.counters);
}

/**
 * Answer a visitor's request.
 *
 * @returns 429 with `Retry-After` from the first limit that refuses, 503 for a request under `p` while the team's keys cannot be had, and otherwise serving's own response, untouched
 * @throws whatever the database or the bucket rejects with
 */
export async function answerSite(request: Request, instance: Instance, holding: SiteHeld): Promise<Response> {
  const { database, store } = instance.install;
  const now = instance.install.now();
  const addressed = instance.addresses.resolve(new URL(request.url));
  const before = await holding.current();
  const early = before === undefined ? undefined : await visitorMinute(request, instance, before, now);
  if (early?.ok === false) return refusalResponse(early);

  const { held, proof, address, found } = await enter(request, addressed, { instance, holding, now });
  // Noted before the limits: a full minute answers first, and the keys were still not to be had.
  if (proof.kind === "unchecked") await noteProblem(instance.install, "login_unchecked");
  const site = found?.site;
  const visitor = early ?? (await visitorMinute(request, instance, held, now));
  if (!visitor.ok) return refusalResponse(visitor);

  const served = site !== undefined && opensAt(addressed, site) ? site : undefined;
  const verdict = served === undefined ? ALLOWED : await checkSiteLimits({ settings: held.settings, site: served.id, now }, instance.counters);
  if (!verdict.ok) {
    // The day's limit of requests is noted once on the day it is reached. A full minute is the limit at work, and is no problem.
    if (verdict.which === "day") await noteProblem(instance.install, "requests_limit_reached");

    return refusalResponse(verdict);
  }

  if (proof.kind === "unchecked") return plain(request, 503, "The login cannot be checked right now. Try again.", { "Retry-After": "60" });

  const response = await serveSite(request, {
    // Serving asks for the site of the same address: it is answered from the query above, so a page view costs one.
    database: { findServed: async (again, at) => (sameAddress(again, address) ? found : database.findServed(again, at)) },
    store,
    settings: held.settings,
    addresses: instance.addresses,
    // Serving asks only under `p`, where the proof above is the answer.
    identify: async () => ({ ok: proof.kind === "vouched" }),
    now: () => now,
  });
  if (served !== undefined) await countRequest({ site: served.id, now, requests: verdict.requests, page: isPageView(request, response) }, instance.counters);

  return response;
}
