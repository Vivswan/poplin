// The zone's bot switches. They cover every hostname of the zone and carry no mark of who set them, so poplin only ever switches one on.

import { BaseBotManagement } from "cloudflare/resources/bot-management/bot-management";
import { type Connection, callCloudflare, type ZonePlan } from "./client";
import { INSTALL_OBJECTS } from "./install-objects";
import { applySteps, reportOf, type Synced } from "./sync";

const SUBJECT = "zone bot switches";
const AI_BOTS_BLOCKED = { ai_bots_protection: INSTALL_OBJECTS.aiBots } as const;
const COVERS_OTHERS = "the AI bot block covers the whole zone, and this zone has hostnames of its own";
const SWITCHED_OFF = "the zone-wide bot switches are set to off";

/** The switches poplin reads, as the zone has them now. */
interface ZoneSwitches {
  readonly ai_bots_protection?: string;
  readonly fight_mode?: boolean;
}

/** The switches a change turns on; Bot Fight Mode is absent unless it is wanted. */
interface WantedSwitches {
  readonly ai_bots_protection: "block";
  readonly fight_mode?: true;
}

/** What an install wants of the zone's bot switches. `sharesZone` says whether the zone has hostnames of its own. */
interface DesiredZoneBots {
  /** `auto` blocks AI bots on a zone with no hostnames of its own; `on` does so on any zone and adds Bot Fight Mode; `off` leaves the switches alone. */
  readonly zoneBots: "auto" | "on" | "off";

  /** The zone's plan: Bot Fight Mode is a switch of the Free plan alone. */
  readonly plan: ZonePlan;

  /** Whether the zone has hostnames of its own, which a zone-wide switch would cover too. */
  readonly sharesZone: boolean;
}

/** One step of a bot switches plan; a `change` carries only the switches to turn on. */
type BotStep =
  | { readonly kind: "change"; readonly subject: string; readonly switches: WantedSwitches }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function skipReason(desired: DesiredZoneBots): string | undefined {
  if (desired.zoneBots === "off") return SWITCHED_OFF;

  if (desired.zoneBots === "auto" && desired.sharesZone) return COVERS_OTHERS;

  return undefined;
}

// No rule can exempt a request from Bot Fight Mode, and it may challenge poplin's own command line and agents, so only `on` asks for it.
function wantedSwitches(desired: DesiredZoneBots): WantedSwitches {
  if (desired.zoneBots === "on" && desired.plan === "free") return { ...AI_BOTS_BLOCKED, fight_mode: true };

  return AI_BOTS_BLOCKED;
}

/**
 * Compute the change the zone's bot switches need.
 *
 * @param current - the switches as the zone has them now; unread, and so absent, for a plan that skips
 * @returns one step: a skip with its reason, a `leave` when every wanted switch is on, or a `change` that turns the wanted ones on and none off
 */
export function planZoneBots(desired: DesiredZoneBots, current: ZoneSwitches | undefined): BotStep[] {
  const reason = skipReason(desired);
  if (reason !== undefined) return [{ kind: "skip", subject: SUBJECT, reason }];

  const switches = wantedSwitches(desired);
  const aiBotsBlocked = current?.ai_bots_protection === switches.ai_bots_protection;
  const fightModeSettled = switches.fight_mode === undefined || current?.fight_mode === true;
  if (aiBotsBlocked && fightModeSettled) return [{ kind: "leave", subject: SUBJECT }];

  return [{ kind: "change", subject: SUBJECT, switches }];
}

/**
 * Make the zone's bot switches match an install.
 *
 * @returns what was changed or left; switches poplin will not touch are a skip with its reason, decided before any request is sent
 */
export async function syncZoneBots(connection: Connection, zoneId: string, desired: DesiredZoneBots): Promise<Synced> {
  if (skipReason(desired) !== undefined) return { ok: true, report: reportOf(planZoneBots(desired, undefined)) };

  const current = await callCloudflare(connection, (api) => new BaseBotManagement(api).get({ zone_id: zoneId }));
  if (!current.ok) return { ...current, report: reportOf([]) };

  return applySteps(planZoneBots(desired, current.value), (step) =>
    callCloudflare(connection, (api) => new BaseBotManagement(api).update({ zone_id: zoneId, ...step.switches })),
  );
}
