// The zone's Worker routes for a layout. A route carries no mark, so poplin's are the ones that name its own Worker.

import { BaseRoutes } from "cloudflare/resources/workers/routes";
import { type Connection, callCloudflare } from "../client";
import { type DomainLayout, siteEnding } from "../layout";
import { applySteps, reportOf, type Synced } from "../sync";

const ROUTED_ELSEWHERE = "a route poplin did not create holds this pattern";

/** A route as the zone has it now; `script` is absent on a route with no Worker. */
interface ZoneRoute {
  readonly id: string;
  readonly pattern: string;
  readonly script: string | undefined;
}

/** The routes an install wants. */
interface DesiredRoutes {
  /** The hostnames the Worker answers on. */
  readonly layout: DomainLayout;

  /** The name of poplin's Worker; a route naming it is poplin's. */
  readonly script: string;
}

/** One step of a routes plan; `subject` is the route's pattern. */
type RouteStep =
  | { readonly kind: "create"; readonly subject: string; readonly script: string }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "remove"; readonly subject: string; readonly id: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

// A route may begin with a wildcard and hold no other, so the suffix alone picks the site hostnames out of the zone.
function workerPatterns(layout: DomainLayout): string[] {
  return [`*${siteEnding(layout)}/*`, `${layout.adminHostname}/*`];
}

function planWorkerRoute(pattern: string, script: string, routes: readonly ZoneRoute[]): RouteStep {
  const existing = routes.find((route) => route.pattern === pattern);
  if (existing === undefined) return { kind: "create", subject: pattern, script };

  if (existing.script === script) return { kind: "leave", subject: pattern };

  return { kind: "skip", subject: pattern, reason: ROUTED_ELSEWHERE };
}

/**
 * Compute the route changes a layout needs.
 *
 * @param routes - every Worker route of the zone as it is now
 * @returns removals of poplin's stale routes first, so a pattern is free before it is created again, then one step per wanted route; no step names a route of another Worker or of none
 */
export function planRoutes(desired: DesiredRoutes, routes: readonly ZoneRoute[]): RouteStep[] {
  const patterns = workerPatterns(desired.layout);
  const stale = routes.filter((route) => route.script === desired.script && !patterns.includes(route.pattern));

  return [
    ...stale.map((route): RouteStep => ({ kind: "remove", subject: route.pattern, id: route.id })),
    ...patterns.map((pattern) => planWorkerRoute(pattern, desired.script, routes)),
  ];
}

/**
 * Make the zone's Worker routes match a layout.
 *
 * @returns what was created, left, and removed; a pattern another route holds is skipped, never taken over
 */
export async function syncRoutes(connection: Connection, zoneId: string, desired: DesiredRoutes): Promise<Synced> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseRoutes(api).list({ zone_id: zoneId })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const routes = listed.value.map(({ id, pattern, script }) => ({ id, pattern, script: script === "" ? undefined : script }));

  return applySteps(planRoutes(desired, routes), (step) => {
    if (step.kind === "remove") return callCloudflare(connection, (api) => new BaseRoutes(api).delete(step.id, { zone_id: zoneId }));

    return callCloudflare(connection, (api) => new BaseRoutes(api).create({ zone_id: zoneId, pattern: step.subject, script: step.script }));
  });
}
