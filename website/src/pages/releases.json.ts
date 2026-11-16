import type { APIRoute } from "astro";
import { releasePins } from "../lib/released.ts";

/** Every release an install may take, by version, with the SHA-256 digest of its files: a build runs no files that differ. Installs of every older version read it, so a field is only ever added. */
export const GET: APIRoute = () => Response.json(releasePins());
