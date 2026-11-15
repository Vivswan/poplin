import type { APIRoute } from "astro";
import { REPOSITORY_URL } from "../lib/paths.ts";
import { released } from "../lib/released.ts";

/** The newest released version, for an install to compare with its own. Installs of every older version read it, so a field is only ever added. */
export const GET: APIRoute = () => {
  const newest = released();

  if (newest === undefined) {
    return Response.json({ version: null });
  }

  return Response.json({ ...newest, notes: `${REPOSITORY_URL}/releases/tag/v${newest.version}` });
};
