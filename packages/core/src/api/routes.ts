// The HTTP API as one table: every route's method and path, with the types of what it takes and what it answers.
//
// The server registers its handlers from this table and a client builds its requests from it, so the two cannot differ.
// A request carries `Authorization: Bearer <token>`. A JSON body goes with `Content-Type: application/json`, a file's bytes with `application/octet-stream`.
// An export and an import are a run of small requests the client drives: `exportSites` a page at a time, then `exportFiles` and `exportFile` for each version; `beginImport`, then the upload routes under the id it answers.

import type * as v from "valibot";

import type { abandonPublish } from "../actions/abandon-publish";
import type { beginImport, ImportRequest } from "../actions/begin-import";
import type { AUDIT_QUERY, listAudit } from "../actions/audit-log";
import type { beginPublish, PUBLISH_REQUEST } from "../actions/begin-publish";
import type { SiteChanges } from "../actions/changes";
import type { changeConfig, readConfig } from "../actions/config";
import type { DELETE_OPTIONS, deleteSite } from "../actions/delete";
import type { EXPORT_FILE_QUERY, EXPORT_FILES_QUERY, EXPORT_QUERY, EXPORT_SITE_QUERY, exportFile, exportFiles, exportSettings, exportSite, exportSites } from "../actions/export";
import type { finishPublish } from "../actions/finish-publish";
import type { importSettings, SETTINGS_IMPORT } from "../actions/import-settings";
import type { LIST_QUERY, listSites } from "../actions/list";
import type { issueToken, listTokens, revokeToken, TOKEN_REQUEST, TokenObject } from "../actions/manage-tokens";
import type { ROLLBACK_OPTIONS } from "../actions/rollback";
import type { showUpload } from "../actions/show-upload";
import type { signEveryoneOut } from "../actions/sign-out";
import type { SiteAnswer } from "../actions/site-object";
import type { uploadFile } from "../actions/upload-file";
import type { SettingValues } from "../records/settings";

/** Where every route starts. */
const BASE = "/api";

/** The response header of a route that answers bytes, holding the media type the file is stored with, percent-encoded as `encodeURIComponent` does. */
export const STORED_TYPE_HEADER = "Poplin-Content-Type";

/** What a route's request carries: no body, a JSON value, or the raw bytes of one file. */
type Sends = "nothing" | "json" | "bytes";

/** What an action answers when it is done, as the response body holds it. */
type Answer<Action extends (...parameters: never[]) => Promise<unknown>> = Omit<Extract<Awaited<ReturnType<Action>>, { readonly ok: true }>, "ok">;

/** The answer of an action on one site. */
type SiteBody = Omit<SiteAnswer, "ok">;

/** What names one site in a path: its label, its bare id, or the public name of a public site. */
interface OneSite {
  readonly site: string;
}

/** What names one upload in a path: the id `beginPublish` answered. */
interface OneUpload {
  readonly upload: string;
}

/**
 * One route.
 *
 * `pattern` is the path as a router matches it, where `:name` stands for one segment. `path` builds the path and query of one request, every part encoded.
 *
 * `answers` is what a done request answers with: JSON, or the bytes of one file as `application/octet-stream`, with the file's stored media type in `STORED_TYPE_HEADER`.
 *
 * `types` is never set: it carries the type of the request body and of the answer to a done request.
 */
export interface Route<Args, Body, Done> {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly pattern: string;
  readonly sends: Sends;
  readonly answers: "json" | "bytes";
  readonly path: (args: Args) => string;
  readonly types?: { readonly body: Body; readonly done: Done };
}

/** Every refusal, whatever the route: the code, a sentence for a person, and the argument, limit, or path the code is about. */
export interface ApiError {
  readonly error: { readonly code: string; readonly message: string; readonly about?: string };
}

/** Build a query string from the values that are given; `""` when none is. */
function queryOf(values: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }

  return query.size === 0 ? "" : `?${query}`;
}

function sitePath(site: string, action = ""): string {
  return `${BASE}/sites/${encodeURIComponent(site)}${action}`;
}

function exportPath(site: string, action = ""): string {
  return `${BASE}/export/sites/${encodeURIComponent(site)}${action}`;
}

function uploadPath(upload: string, action = ""): string {
  return `${BASE}/uploads/${encodeURIComponent(upload)}${action}`;
}

/** A route that carries no body; it answers JSON, unless `answers` says bytes. */
function ask<Args, Done>(
  method: Route<Args, undefined, Done>["method"],
  pattern: string,
  path: (args: Args) => string,
  answers: Route<Args, undefined, Done>["answers"] = "json",
): Route<Args, undefined, Done> {
  return { method, pattern: `${BASE}${pattern}`, sends: "nothing", answers, path };
}

/** A route that carries a body: JSON, unless `sends` says bytes. */
function send<Args, Body, Done>(method: Route<Args, Body, Done>["method"], pattern: string, path: (args: Args) => string, sends: Sends = "json"): Route<Args, Body, Done> {
  return { method, pattern: `${BASE}${pattern}`, sends, answers: "json", path };
}

/** Every route of the API, by the name of the action it runs. A done request answers 200 with the JSON of its `done` type, or with the bytes of its `done` type's `body`; any other answers an `ApiError`. */
export const ROUTES = {
  whoami: ask<void, { readonly token: TokenObject }>("GET", "/whoami", () => `${BASE}/whoami`),
  logout: ask<void, Answer<typeof revokeToken>>("DELETE", "/token", () => `${BASE}/token`),
  listTokens: ask<void, Answer<typeof listTokens>>("GET", "/tokens", () => `${BASE}/tokens`),
  issueToken: send<void, v.InferInput<typeof TOKEN_REQUEST>, Answer<typeof issueToken>>("POST", "/tokens", () => `${BASE}/tokens`),
  revokeToken: ask<{ readonly token: string }, Answer<typeof revokeToken>>("DELETE", "/tokens/:token", ({ token }) => `${BASE}/tokens/${encodeURIComponent(token)}`),

  listSites: ask<v.InferInput<typeof LIST_QUERY>, Answer<typeof listSites>>("GET", "/sites", ({ trash, limit, after }) => {
    return `${BASE}/sites${queryOf({ trash, limit, after_updated_at: after?.updated_at, after_id: after?.id })}`;
  }),
  getSite: ask<OneSite, SiteBody>("GET", "/sites/:site", ({ site }) => sitePath(site)),
  updateSite: send<OneSite, SiteChanges, SiteBody>("PATCH", "/sites/:site", ({ site }) => sitePath(site)),
  rollbackSite: send<OneSite, v.InferInput<typeof ROLLBACK_OPTIONS>, SiteBody>("POST", "/sites/:site/rollback", ({ site }) => sitePath(site, "/rollback")),
  newLink: ask<OneSite, SiteBody>("POST", "/sites/:site/new-link", ({ site }) => sitePath(site, "/new-link")),
  deleteSite: ask<OneSite & v.InferInput<typeof DELETE_OPTIONS>, Answer<typeof deleteSite>>("DELETE", "/sites/:site", ({ site, forever }) => {
    return `${sitePath(site)}${queryOf({ forever })}`;
  }),
  restoreSite: ask<OneSite, SiteBody>("POST", "/sites/:site/restore", ({ site }) => sitePath(site, "/restore")),

  beginPublish: send<void, v.InferInput<typeof PUBLISH_REQUEST>, Answer<typeof beginPublish>>("POST", "/uploads", () => `${BASE}/uploads`),
  showUpload: ask<OneUpload, Answer<typeof showUpload>>("GET", "/uploads/:upload", ({ upload }) => uploadPath(upload)),
  uploadFile: send<OneUpload & { readonly path: string }, ReadableStream<Uint8Array> | Uint8Array, Answer<typeof uploadFile>>(
    "PUT",
    "/uploads/:upload/file",
    ({ upload, path }) => `${uploadPath(upload, "/file")}${queryOf({ path })}`,
    "bytes",
  ),
  finishPublish: ask<OneUpload, Answer<typeof finishPublish>>("POST", "/uploads/:upload/finish", ({ upload }) => uploadPath(upload, "/finish")),
  abandonPublish: ask<OneUpload, Answer<typeof abandonPublish>>("DELETE", "/uploads/:upload", ({ upload }) => uploadPath(upload)),

  exportSettings: ask<void, Answer<typeof exportSettings>>("GET", "/export/settings", () => `${BASE}/export/settings`),
  exportSites: ask<v.InferInput<typeof EXPORT_QUERY>, Answer<typeof exportSites>>("GET", "/export/sites", ({ limit, after, all_versions }) => {
    return `${BASE}/export/sites${queryOf({ limit, after, all_versions })}`;
  }),
  exportSite: ask<OneSite & v.InferInput<typeof EXPORT_SITE_QUERY>, Answer<typeof exportSite>>("GET", "/export/sites/:site", ({ site, all_versions }) => {
    return `${exportPath(site)}${queryOf({ all_versions })}`;
  }),
  exportFiles: ask<OneSite & v.InferInput<typeof EXPORT_FILES_QUERY>, Answer<typeof exportFiles>>("GET", "/export/sites/:site/files", ({ site, version, limit, cursor }) => {
    return `${exportPath(site, "/files")}${queryOf({ version, limit, cursor })}`;
  }),
  exportFile: ask<OneSite & v.InferInput<typeof EXPORT_FILE_QUERY>, Answer<typeof exportFile>>(
    "GET",
    "/export/sites/:site/file",
    ({ site, version, path }) => `${exportPath(site, "/file")}${queryOf({ version, path })}`,
    "bytes",
  ),
  importSettings: send<void, v.InferInput<typeof SETTINGS_IMPORT>, Answer<typeof importSettings>>("POST", "/import/settings", () => `${BASE}/import/settings`),
  beginImport: send<void, ImportRequest, Answer<typeof beginImport>>("POST", "/import/sites", () => `${BASE}/import/sites`),

  readConfig: ask<void, Answer<typeof readConfig>>("GET", "/config", () => `${BASE}/config`),
  changeConfig: send<void, Partial<SettingValues>, Answer<typeof changeConfig>>("PATCH", "/config", () => `${BASE}/config`),
  signEveryoneOut: ask<void, Answer<typeof signEveryoneOut>>("DELETE", "/sessions", () => `${BASE}/sessions`),
  listAudit: ask<v.InferInput<typeof AUDIT_QUERY>, Answer<typeof listAudit>>("GET", "/audit", ({ limit, before }) => `${BASE}/audit${queryOf({ limit, before })}`),
} as const;
