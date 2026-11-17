// The settings the zone's guard rules are written from, carried to Cloudflare with the key poplin keeps: the outside pages rule and the bots rule are made to match them, by the code a repair runs.
//
//   setting                   rule at Cloudflare                          written under
//   outside_pages             the outside pages rule: there, or removed   "Zone WAF Write"
//   search_engines_allowed    the bots rule: its expression               "Zone WAF Write"
//
// The zone is found among the account's zones, under "Zone Read". No record, route, redirect, or bot switch is read or changed: the key holds no right to write those, and a repair does.
// No answer carries the key or a text Cloudflare sent.

import type { RulesFollow } from "@poplin/app/src/console/settings/rules-follow";
import { listZones } from "../../../shared/install/client";
import type { DomainLayout } from "../../layout";
import { syncGuards } from "./guards";
import { type KeptKey, keyed } from "../../../shared/install/key/kept-key";

/** Cloudflare's name of the right the zone is found under. */
const ZONE_RIGHT = "Zone Read";

/** Cloudflare's name of the right the rules are read and written under. */
const RULES_RIGHT = "Zone WAF Write";

/** The calls to Cloudflare one writing of the rules makes at most, before any the SDK sends again: the zones listed, which takes a second call for the page after the last, the rules read, and each of the two rules written. */
export const RULES_PUSH_CALLS = 5;

/**
 * Make the install's way to carry its settings to the guard rules of its zone.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every try `no_key` and calls nothing
 * @param place - the account the zone is in, and the install's hostnames, which the rules read
 * @returns the rules' side at Cloudflare. A try is done only when both rules stand as the settings ask: one that stopped after the first has written it. A rule the zone's plan has no room for is left out, as a repair leaves it.
 *   The rules are planned from one read, which may trail a write: a try that wrote nothing says so, and the install trusts that only of a try made long after the last write
 */
export function createRulesFollow(key: KeptKey | undefined, place: { readonly accountId: string; readonly layout: DomainLayout }): RulesFollow {
  return {
    holdsKey: () => key !== undefined,

    async push(rules) {
      const zones = await keyed(key, ZONE_RIGHT, (connection) => listZones(connection, place.accountId));
      if (!zones.ok) return { ok: false, refusal: zones.refusal };

      const zone = zones.value.find((candidate) => candidate.name === place.layout.domain);
      if (zone === undefined) return { ok: false, refusal: "not_made" };

      const desired = { layout: place.layout, plan: zone.plan, outsidePages: rules.outside_pages, searchEnginesAllowed: rules.search_engines_allowed };
      const written = await keyed(key, RULES_RIGHT, async (connection) => {
        const synced = await syncGuards(connection, zone.id, desired, "apply");

        return synced.ok ? { ok: true, value: synced.report.changedNothing } : synced;
      });

      return written.ok ? { ok: true, rules: written.value ? "stood" : "written" } : { ok: false, refusal: written.refusal };
    },
  };
}
