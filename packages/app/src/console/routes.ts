// Every data route of the console, as one application whose type the client is built from: a route added here is one the client can call, with its query, its body, and its answer typed.

import { Hono } from "hono";

import { accessRoutes } from "./access-routes";
import { activityRoutes } from "./activity-routes";
import type { Shared } from "./data";
import { domainRoutes } from "./domain-routes";
import { duplicateRoutes } from "./duplicate-routes";
import { frameRoutes } from "./frame-routes";
import { problemsRoutes } from "./problems-routes";
import { settingsRoutes } from "./settings-routes";
import { siteRoutes } from "./site-routes";
import { usageRoutes } from "./usage-routes";
import { visitsRoutes } from "./visits-routes";

/** The data routes, each screen's own chained on. They are mounted under `/data`, after the session check and the guard on changes. */
export const dataRoutes = new Hono<Shared>()
  .route("/", frameRoutes)
  .route("/", siteRoutes)
  .route("/", duplicateRoutes)
  .route("/", accessRoutes)
  .route("/", activityRoutes)
  .route("/", usageRoutes)
  .route("/", problemsRoutes)
  .route("/", visitsRoutes)
  .route("/", settingsRoutes)
  .route("/", domainRoutes);

/** The type the client's calls are checked against. */
export type DataRoutes = typeof dataRoutes;
