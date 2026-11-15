// The data of the Access screen: the logins that wait to be allowed, the people who can log in, and the tokens of computers and agents.
//
//   GET  /logins                   the newest logins that wait, without their codes, and how many more wait
//   GET  /logins/find?code=<code>  the login a terminal's address names, to review; counted as a try at a code
//   GET  /logins/<id>              one waiting login, to review
//   POST /logins/decide            allow or deny the login under a code; counted as a try at a code
//   GET  /people                   the emails that can log in, and which one asks
//   POST /people/add, /remove      one email in, or out, in one step each
//   GET  /tokens                   every token, never its value; ?sort= with ?dir=
//   POST /tokens/<id>/remove       the token stops working

import { vValidator } from "@hono/valibot-validator";
import { decideLogin, listLogins, showLogin } from "@poplin/core/src/actions/computer-logins";
import { readConfig } from "@poplin/core/src/actions/config";
import { addLogin, removeLogin } from "@poplin/core/src/actions/logins";
import { listTokens, revokeToken } from "@poplin/core/src/actions/manage-tokens";
import { CODE_KEY } from "@poplin/core/src/api/routes";
import { Hono, type MiddlewareHandler } from "hono";
import * as v from "valibot";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";

/** How many waiting logins the screen lists: the rest are counted. */
const MOST_LISTED = 10;

/** What each sortable column of the tokens is ordered by. */
const TOKEN_SORT_KEYS = {
  name: (token: Token) => token.note.toLowerCase(),
  allowed: (token: Token) => token.created,
} as const;

/** What the tokens' address may ask of the listing. */
const TOKENS_QUERY = v.object({ sort: v.optional(v.picklist(["name", "allowed"])), dir: v.optional(v.picklist(["asc", "desc"])) });

/** What names one waiting login in a route's path: its id, which proves nothing. */
const ONE_LOGIN = v.object({ login: v.string() });

/** What names one token in a route's path: its id. */
const ONE_TOKEN = v.object({ token: v.string() });

/** The code a terminal's address carries. */
const CODED = v.object({ [CODE_KEY]: v.string() });

/** What a decision carries: the code, whether the computer is let in, whether the box was ticked, and the scope it is let in with. */
const DECISION = v.object({ code: v.string(), allow: v.boolean(), confirm: v.optional(v.boolean()), scope: v.optional(v.picklist(["publisher", "admin"])) });

/** One email to add or take out, as it was typed. */
const PERSON = v.object({ login: v.string() });

/** One token as the listing answers it. */
type Token = Extract<Awaited<ReturnType<typeof listTokens>>, { ok: true }>["tokens"][number];

/** Refuse a try at a login's code that does not fit the asking visitor's minute. */
const fewCodes: MiddlewareHandler<Shared> = async (context, next) => {
  if (!(await context.get("takesCode")())) return refused(context, { code: "too_many_tries" });

  return next();
};

/** Order the tokens by a column. Left out, they stay as listed: the newest first. */
function sortedTokens(tokens: readonly Token[], key: keyof typeof TOKEN_SORT_KEYS | undefined, descending: boolean): readonly Token[] {
  if (key === undefined) return tokens;

  const read = TOKEN_SORT_KEYS[key] as (token: Token) => string | number;
  const ordered = [...tokens].sort((left, right) => {
    const [a, b] = [read(left), read(right)];
    if (a === b) return left.id.localeCompare(right.id);

    return a < b ? -1 : 1;
  });

  return descending ? ordered.reverse() : ordered;
}

/** The Access screen's data routes. Each calls the action the dashboard's own page calls; a login's code is answered only for the one login under review. */
export const accessRoutes = new Hono<Shared>()
  .get("/logins", async (context) => {
    const { install, actor } = context.get("asker");
    const listed = await listLogins(install, actor);
    if (!listed.ok) return refused(context, listed);

    const logins = listed.logins.slice(0, MOST_LISTED).map(({ id, scope, computer, asked }) => ({ id, scope, computer, asked }));

    return context.json({ ok: true as const, logins, more: listed.logins.length - logins.length });
  })
  .get("/logins/find", fewCodes, vValidator("query", CODED, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const shown = await showLogin(install, actor, context.req.valid("query")[CODE_KEY]);

    return shown.ok ? context.json({ ok: true as const, login: shown.login }) : refused(context, shown);
  })
  .get("/logins/:login", vValidator("param", ONE_LOGIN, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const listed = await listLogins(install, actor);
    if (!listed.ok) return refused(context, listed);

    const login = listed.logins.find((entry) => entry.id === context.req.valid("param").login);

    return login === undefined ? refused(context, { code: "login_gone" }) : context.json({ ok: true as const, login });
  })
  .post("/logins/decide", fewCodes, vValidator("json", DECISION, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { code, allow, confirm, scope } = context.req.valid("json");
    // A computer is let in only by one who said the codes match; keeping one out needs no such word.
    if (allow && confirm !== true) return refused(context, { code: "not_confirmed", about: "confirm" });

    const decided = await decideLogin(install, actor, { code, allow, ...(allow && scope !== undefined ? { scope } : {}) });

    return decided.ok ? context.json({ ok: true as const, allowed: allow, scope: decided.login.scope }) : refused(context, decided);
  })
  .get("/people", async (context) => {
    const { install, actor } = context.get("asker");
    const config = await readConfig(install, actor);

    return config.ok ? context.json({ ok: true as const, logins: config.values.logins, you: context.get("email") }) : refused(context, config);
  })
  .post("/people/add", vValidator("json", PERSON, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const added = await addLogin(install, actor, context.req.valid("json"));

    return added.ok ? context.json({ ok: true as const, login: added.login }) : refused(context, added);
  })
  .post("/people/remove", vValidator("json", PERSON, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const removed = await removeLogin(install, actor, context.req.valid("json"));

    return removed.ok ? context.json({ ok: true as const, login: removed.login }) : refused(context, removed);
  })
  .get("/tokens", vValidator("query", TOKENS_QUERY, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { sort, dir } = context.req.valid("query");
    const listed = await listTokens(install, actor);

    return listed.ok ? context.json({ ok: true as const, tokens: sortedTokens(listed.tokens, sort, dir === "desc") }) : refused(context, listed);
  })
  .post("/tokens/:token/remove", vValidator("param", ONE_TOKEN, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const revoked = await revokeToken(install, actor, context.req.valid("param").token);
    if (revoked.ok) return context.json({ ok: true as const, name: revoked.token.note });

    return refused(context, revoked.code === "not_allowed" ? revoked : { code: "token_gone" });
  });
