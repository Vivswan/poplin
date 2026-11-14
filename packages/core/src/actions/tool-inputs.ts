// What each MCP tool takes: the request of its action, as the API takes it, with the site it is about.
//
// Each input is built from the schema its action checks a request with, so a setting the API gains is one the tools take.
// `publish_site` takes a `path` on the machine the server runs on in place of the list of files and of the entry page's title, which the server reads there.
// `duplicate_site` takes no `upload`: the server makes every call of a copy itself.

import * as v from "valibot";

import type { SITE_ACTIONS } from "../actions";
import { PUBLISH_REQUEST } from "./begin-publish";
import { SITE_CHANGES } from "./changes";
import { DELETE_OPTIONS } from "./delete";
import { DUPLICATE_REQUEST } from "./duplicate";
import { LIST_QUERY } from "./list";
import { ROLLBACK_OPTIONS } from "./rollback";

/** What a tool about one site takes: a reference to the site, and nothing else. */
const ONE_SITE = v.strictObject({ site: v.string() });

/** The input of every MCP tool, by the tool's name. A tool lacking here, or one that is no site action, does not compile. */
export const TOOL_INPUTS = {
  publish_site: v.strictObject({ path: v.string(), ...v.omit(PUBLISH_REQUEST, ["files", "page_title"]).entries }),
  update_site: v.strictObject({ ...ONE_SITE.entries, ...SITE_CHANGES.entries }),
  get_site: ONE_SITE,
  list_sites: v.pick(LIST_QUERY, ["trash"]),
  rollback_site: v.strictObject({ ...ONE_SITE.entries, ...ROLLBACK_OPTIONS.entries }),
  new_link: ONE_SITE,
  delete_site: v.strictObject({ ...ONE_SITE.entries, ...DELETE_OPTIONS.entries }),
  restore_site: ONE_SITE,
  duplicate_site: v.strictObject({ ...ONE_SITE.entries, ...v.omit(DUPLICATE_REQUEST, ["upload"]).entries }),
} as const satisfies Readonly<Record<(typeof SITE_ACTIONS)[number]["tool"], v.GenericSchema>>;
