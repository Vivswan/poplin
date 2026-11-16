import type { APIRoute } from "astro";
import { releasePins } from "../lib/released.ts";

/** Every release an install may take, by version: the SHA-256 digests of its source files and of the manifest of its built files, and its schema. Installs of every older version read it, so a field is only ever added. */
export const GET: APIRoute = () => Response.json(releasePins());
