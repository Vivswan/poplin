// The zone's Worker routes for a layout. A route carries no mark, so poplin's are the ones that name its own Worker, and a route with no Worker is removed only when the caller says an earlier run made it.

import { BaseRoutes } from "cloudflare/resources/workers/routes";
import { type Connection, callCloudflare } from "./client";
import { type Hostname, isUnder } from "./hostname";
import { type DomainLayout, ownHostnames, siteParent } from "./layout";
import { applySteps, reportOf, type Synced } from "./sync";

const ROUTED_ELSEWHERE = "a route poplin did not create holds this pattern";
const OWN_HOSTNAME = "the Worker answers on this hostname";

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

  /** The zone's other hostnames, each kept away from the Worker by a route with none. */
  readonly excluded: readonly Hostname[];

  /** Hostnames an earlier run excluded, as the install's settings recorded; their routes are poplin's to remove. */
  readonly retired: readonly Hostname[];
}

/** One step of a routes plan; `subject` is the route's pattern. */
type RouteStep =
  | { readonly kind: "create"; readonly subject: string; readonly script: string | undefined }
  | { readonly kind: "leave"; readonly subject: string }
  | { readonly kind: "remove"; readonly subject: string; readonly id: string }
  | { readonly kind: "skip"; readonly subject: string; readonly reason: string };

function everyPath(host: string): string {
  return `${host}/*`;
}

function workerPatterns(layout: DomainLayout): string[] {
  const parent = siteParent(layout);
  const uncovered = ownHostnames(layout).filter((hostname) => !isUnder(hostname, parent));

  return [everyPath(`*.${parent}`), ...uncovered.map(everyPath)];
}

function planWorkerRoute(pattern: string, script: string, routes: readonly ZoneRoute[]): RouteStep {
  const existing = routes.find((route) => route.pattern === pattern);
  if (existing === undefined) return { kind: "create", subject: pattern, script };

  if (existing.script === script) return { kind: "leave", subject: pattern };

  return { kind: "skip", subject: pattern, reason: ROUTED_ELSEWHERE };
}

function planExclusion(hostname: Hostname, desired: DesiredRoutes, routes: readonly ZoneRoute[]): RouteStep {
  const pattern = everyPath(hostname);
  if (ownHostnames(desired.layout).includes(hostname)) return { kind: "skip", subject: pattern, reason: OWN_HOSTNAME };

  // A route to another Worker keeps the name off poplin's as well as a route with none does.
  const keepsAway = routes.some((route) => route.pattern === pattern && route.script !== desired.script);
  if (keepsAway) return { kind: "leave", subject: pattern };

  return { kind: "create", subject: pattern, script: undefined };
}

/**
 * Compute the route changes a layout needs.
 *
 * @param routes - every Worker route of the zone as it is now
 * @returns removals of poplin's stale routes first, so a pattern is free before it is created again, then one step per wanted route
 */
export function planRoutes(desired: DesiredRoutes, routes: readonly ZoneRoute[]): RouteStep[] {
  const patterns = workerPatterns(desired.layout);
  const excluded = [...new Set(desired.excluded)];
  const retired = desired.retired.filter((hostname) => !excluded.includes(hostname)).map(everyPath);

  const isStale = (route: ZoneRoute): boolean => {
    if (route.script === undefined) return retired.includes(route.pattern);

    return route.script === desired.script && !patterns.includes(route.pattern);
  };
  const stale = routes.filter(isStale);
  const kept = routes.filter((route) => !isStale(route));

  return [
    ...stale.map((route): RouteStep => ({ kind: "remove", subject: route.pattern, id: route.id })),
    ...patterns.map((pattern) => planWorkerRoute(pattern, desired.script, kept)),
    ...excluded.map((hostname) => planExclusion(hostname, desired, kept)),
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
