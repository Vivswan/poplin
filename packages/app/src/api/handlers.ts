// The handler of every route: it checks what was sent against the action's schema, calls that one action, and hands back its answer. No rule lives here.

import { abandonPublish } from "@poplin/core/src/actions/abandon-publish";
import { beginImport, IMPORT_REQUEST } from "@poplin/core/src/actions/begin-import";
import { AUDIT_QUERY, listAudit } from "@poplin/core/src/actions/audit-log";
import { beginPublish, PUBLISH_REQUEST, type UploadLimits } from "@poplin/core/src/actions/begin-publish";
import { SITE_CHANGES } from "@poplin/core/src/actions/changes";
import { beginLogin, LOGIN_REQUEST, LOGIN_SECRET, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { DELETE_OPTIONS, deleteSite } from "@poplin/core/src/actions/delete";
import { EXPORT_FILE_QUERY, EXPORT_FILES_QUERY, EXPORT_QUERY, EXPORT_SITE_QUERY, exportFile, exportFiles, exportSettings, exportSite, exportSites } from "@poplin/core/src/actions/export";
import { finishPublish } from "@poplin/core/src/actions/finish-publish";
import { importSettings, SETTINGS_IMPORT } from "@poplin/core/src/actions/import-settings";
import { LIST_QUERY, listSites } from "@poplin/core/src/actions/list";
import { issueToken, listTokens, revokeToken, TOKEN_REQUEST, tokenObject } from "@poplin/core/src/actions/manage-tokens";
import { newLink } from "@poplin/core/src/actions/new-link";
import { type Install, type Refused, refuse } from "@poplin/core/src/actions/records";
import { restoreSite } from "@poplin/core/src/actions/restore";
import { ROLLBACK_OPTIONS, rollbackSite } from "@poplin/core/src/actions/rollback";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";
import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { showUpload } from "@poplin/core/src/actions/show-upload";
import { uploadFile } from "@poplin/core/src/actions/upload-file";
import { ALLOW_PAGE, CODE_KEY, type OPEN_ROUTES, type ROUTES } from "@poplin/core/src/api/routes";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { TokenRecord } from "@poplin/core/src/auth/tokens";
import * as v from "valibot";

import { capBody, type QueryShape } from "./body";
import type { Result } from "./respond";

/** The query each route takes; a route missing here takes none. */
export const QUERIES: { readonly [Name in RouteName]?: QueryShape } = {
  listSites: { trash: "switch", limit: "number", after_updated_at: "number", after_id: "text" },
  deleteSite: { forever: "switch" },
  uploadFile: { path: "text" },
  exportSites: { limit: "number", after: "text", all_versions: "switch" },
  exportSite: { all_versions: "switch" },
  exportFiles: { version: "number", limit: "number", cursor: "text" },
  exportFile: { version: "number", path: "text" },
  listAudit: { limit: "number", before: "number" },
};

/** The name of a route in the table. */
export type RouteName = keyof typeof ROUTES;

/** The name of a route that takes no token. */
export type OpenName = (typeof OPEN_ROUTES)[number];

/** One request as its handler takes it: who asks, and what the route's path, query, and body hold. */
export interface Call {
  /** The install the action runs on. */
  readonly install: Install;

  /** The record of the token the request presented. */
  readonly token: TokenRecord;

  /** Whoever that token stands for. */
  readonly actor: Actor;

  /** The path's `:site`, which has the form of a site reference; `""` on a route without one. */
  readonly site: string;

  /** The path's `:upload` or `:token`; `""` on a route without one. */
  readonly named: string;

  /** The query, read by the route's shape. */
  readonly query: Readonly<Record<string, string | number | boolean>>;

  /** The parsed JSON body of a route that sends one, `undefined` otherwise. */
  readonly body: unknown;

  /** The request itself, whose body a route that sends bytes reads. */
  readonly request: Request;

  /** What one request can carry. */
  readonly limits: UploadLimits;
}

/** One request to a route that takes no token: nobody asks, so there is no actor. */
interface OpenCall {
  /** The install the action runs on. */
  readonly install: Install;

  /** The parsed JSON body. */
  readonly body: unknown;

  /** The origin the request was sent to, which is the dashboard's. */
  readonly origin: string;
}

/** What the handler of a route answers: the route's `done` type, or a refusal. */
type Handler<Name extends RouteName, Asked = Call> = (call: Asked) => Promise<Result<NonNullable<(typeof ROUTES)[Name]["types"]>["done"]>>;

/** Check a sent value against an action's schema, and run the action on what passes. */
async function checked<Schema extends v.GenericSchema, Answer>(
  schema: Schema,
  sent: unknown,
  run: (asked: v.InferOutput<Schema>) => Promise<Answer>,
): Promise<Answer | Refused<"bad_argument">> {
  const asked = v.safeParse(schema, sent);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "body");

  return run(asked.output);
}

/** The listing a query asks for: the two halves of the cursor become one `after`. */
function listingOf(query: Call["query"]): unknown {
  const { after_updated_at: updated_at, after_id: id, ...rest } = query;
  if (updated_at === undefined && id === undefined) return rest;

  return { ...rest, after: { updated_at, id } };
}

/** Store the body of a request as one file, reading no more of it than one request may carry. */
async function storeBody({ install, actor, named, query, request, limits }: Call): ReturnType<Handler<"uploadFile">> {
  const body = capBody(request, limits.fileBytes);
  if (typeof query.path !== "string") return refuse("bad_argument", "path");

  try {
    const stored = await uploadFile(install, actor, { upload: named, path: query.path, body: body.stream });

    return body.exceeded() ? refuse("too_large", "max_file_size") : stored;
  } catch (error) {
    if (body.exceeded()) return refuse("too_large", "max_file_size");

    throw error;
  }
}

/** Begin a login, and add the address of the dashboard page where an admin decides it. */
async function beginWithAddress({ install, body, origin }: OpenCall): ReturnType<Handler<"beginLogin">> {
  const begun = await checked(LOGIN_REQUEST, body, (request) => beginLogin(install, request));
  if (!begun.ok) return begun;

  return { ...begun, verify_url: `${origin}${ALLOW_PAGE}?${new URLSearchParams({ [CODE_KEY]: begun.code })}` };
}

/** The handler of every route that takes no token, by the route's name. */
export const OPEN_HANDLERS: { readonly [Name in OpenName]: Handler<Name, OpenCall> } = {
  beginLogin: beginWithAddress,
  redeemLogin: ({ install, body }) => checked(LOGIN_SECRET, body, (request) => redeemLogin(install, request)),
};

/** The handler of every route that takes a token, by the route's name. A route without one does not compile. */
export const HANDLERS: { readonly [Name in Exclude<RouteName, OpenName>]: Handler<Name> } = {
  whoami: async ({ token }) => ({ ok: true, token: tokenObject(token) }),
  logout: ({ install, actor, token }) => revokeToken(install, actor, token.id),
  listTokens: ({ install, actor }) => listTokens(install, actor),
  issueToken: ({ install, actor, body }) => checked(TOKEN_REQUEST, body, (request) => issueToken(install, actor, request)),
  revokeToken: ({ install, actor, named }) => revokeToken(install, actor, named),

  listSites: ({ install, actor, query }) => checked(LIST_QUERY, listingOf(query), (asked) => listSites(install, actor, asked)),
  getSite: ({ install, actor, site }) => getSite(install, actor, site),
  updateSite: ({ install, actor, site, body }) => checked(SITE_CHANGES, body, (changes) => updateSite(install, actor, { ...changes, site })),
  rollbackSite: ({ install, actor, site, body }) => checked(ROLLBACK_OPTIONS, body, (options) => rollbackSite(install, actor, { ...options, site })),
  newLink: ({ install, actor, site }) => newLink(install, actor, site),
  deleteSite: ({ install, actor, site, query }) => checked(DELETE_OPTIONS, query, (options) => deleteSite(install, actor, { ...options, site })),
  restoreSite: ({ install, actor, site }) => restoreSite(install, actor, site),

  beginPublish: ({ install, actor, body, limits }) => checked(PUBLISH_REQUEST, body, (request) => beginPublish(install, actor, request, limits)),
  showUpload: ({ install, actor, named }) => showUpload(install, actor, named),
  uploadFile: storeBody,
  finishPublish: ({ install, actor, named }) => finishPublish(install, actor, named),
  abandonPublish: ({ install, actor, named }) => abandonPublish(install, actor, named),

  exportSettings: ({ install, actor }) => exportSettings(install, actor),
  exportSites: ({ install, actor, query }) => checked(EXPORT_QUERY, query, (asked) => exportSites(install, actor, asked)),
  exportSite: ({ install, actor, site, query }) => checked(EXPORT_SITE_QUERY, query, (asked) => exportSite(install, actor, { ...asked, site })),
  exportFiles: ({ install, actor, site, query }) => checked(EXPORT_FILES_QUERY, query, (asked) => exportFiles(install, actor, { ...asked, site })),
  exportFile: ({ install, actor, site, query }) => checked(EXPORT_FILE_QUERY, query, (asked) => exportFile(install, actor, { ...asked, site })),
  importSettings: ({ install, actor, body }) => checked(SETTINGS_IMPORT, body, (request) => importSettings(install, actor, request)),
  beginImport: ({ install, actor, body, limits }) => checked(IMPORT_REQUEST, body, (request) => beginImport(install, actor, request, limits)),

  readConfig: ({ install, actor }) => readConfig(install, actor),
  changeConfig: ({ install, actor, body }) => changeConfig(install, actor, body),
  signEveryoneOut: ({ install, actor }) => signEveryoneOut(install, actor),
  listAudit: ({ install, actor, query }) => checked(AUDIT_QUERY, query, (asked) => listAudit(install, actor, asked)),
};
