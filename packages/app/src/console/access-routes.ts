// The data of the Access screen: the logins that wait to be allowed, the people who can log in, and the tokens of computers and agents.
//
//   GET  /logins                   the newest logins that wait, and how many more wait
//   GET  /logins/<id>              one waiting login, to review: no part of its code
//   POST /logins/decide            deny a login, or allow it with the scope the person chose and the end of its code, which they typed; counted as a try at a code
//   GET  /people                   the emails that can log in, which one asks, and how many tokens that work each is behind
//   POST /people/add, /remove      one email in, or out with every token that user allowed, in one step each; the users are then carried to the provider's list, and `note` is the sentence of a change that did not reach it
//   GET  /tokens                   every token that works, never its value; ?sort= with ?dir=; and the newest that ended
//   POST /tokens/<id>/remove       the token stops working, and is listed among the ended ones

import { vValidator } from "@hono/valibot-validator";
import { decideLogin, listLogins, showLogin } from "@poplin/core/src/actions/computer-logins";
import { readConfig } from "@poplin/core/src/actions/config";
import { addLogin, removeLogin } from "@poplin/core/src/actions/logins";
import { countUserTokens, listTokenStates, revokeToken } from "@poplin/core/src/actions/manage-tokens";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import * as v from "valibot";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";
import { followUsers } from "./access/users-follow";

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

/** What a decision carries: the login's id and whether the computer is let in; for one that is, the scope the person chose, which is never left to what the computer asked, and the letters they typed. */
const DECISION = v.variant("allow", [
  v.object({ login: v.string(), allow: v.literal(false) }),
  v.object({ login: v.string(), allow: v.literal(true), scope: v.picklist(["publisher", "admin"]), letters: v.string() }),
]);

/** What a change of the users says in a console that carries none of them to the provider and has a Domain screen: a repair there carries them. */
const NEXT_REPAIR = "Next, open Domain and press Repair.";

/** One email to add or take out, as it was typed. */
const PERSON = v.object({ login: v.string() });

/** One token as the listing answers it. */
type Token = Extract<Awaited<ReturnType<typeof listTokenStates>>, { ok: true }>["tokens"][number];

/** Refuse a try at a login's code that does not fit the asking visitor's minute. It stands behind the check of the body, so a request that is no decision spends no try. */
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

/**
 * Carry the users to the provider after a change of them was stored.
 *
 * @returns the sentence of a change that did not reach the provider's list, to show after the word that it is saved; `null` where it did.
 *   A console built without the provider's side of the users points to its Domain screen, and says nothing where it has none
 */
async function carried(context: Context<Shared>): Promise<string | null> {
  const follow = context.get("follow");
  if (follow === undefined) return context.get("domain") === undefined ? null : NEXT_REPAIR;

  const followed = await followUsers(context.get("asker").install, follow);

  return followed.carried ? null : followed.sentence;
}

/** The Access screen's data routes. Each calls the action the dashboard's own page calls; no part of a login's code is in an answer. */
export const accessRoutes = new Hono<Shared>()
  .get("/logins", async (context) => {
    const { install, actor } = context.get("asker");
    const listed = await listLogins(install, actor);
    if (!listed.ok) return refused(context, listed);

    const logins = listed.logins.slice(0, MOST_LISTED).map(({ id, scope, computer, asked }) => ({ id, scope, computer, asked }));

    return context.json({ ok: true as const, logins, more: listed.logins.length - logins.length });
  })
  .get("/logins/:login", vValidator("param", ONE_LOGIN, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const shown = await showLogin(install, actor, context.req.valid("param").login);

    return shown.ok ? context.json({ ok: true as const, login: shown.login }) : refused(context, shown);
  })
  .post("/logins/decide", vValidator("json", DECISION, refuseInvalid), fewCodes, async (context) => {
    const { install, actor } = context.get("asker");
    const decision = context.req.valid("json");
    const decided = await decideLogin(install, actor, decision);

    return decided.ok ? context.json({ ok: true as const, allowed: decision.allow, scope: decided.login.scope }) : refused(context, decided);
  })
  .get("/people", async (context) => {
    const { install, actor } = context.get("asker");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const counted = await countUserTokens(install, actor);
    if (!counted.ok) return refused(context, counted);

    return context.json({ ok: true as const, logins: config.values.logins, you: context.get("email"), tokens: counted.counts });
  })
  .post("/people/add", vValidator("json", PERSON, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const added = await addLogin(install, actor, context.req.valid("json"));
    if (!added.ok) return refused(context, added);

    return context.json({ ok: true as const, login: added.login, note: await carried(context) });
  })
  .post("/people/remove", vValidator("json", PERSON, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const removed = await removeLogin(install, actor, context.req.valid("json"));
    if (!removed.ok) return refused(context, removed);

    return context.json({ ok: true as const, login: removed.login, note: await carried(context) });
  })
  .get("/tokens", vValidator("query", TOKENS_QUERY, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { sort, dir } = context.req.valid("query");
    const listed = await listTokenStates(install, actor);
    if (!listed.ok) return refused(context, listed);

    return context.json({ ok: true as const, tokens: sortedTokens(listed.tokens, sort, dir === "desc"), ended: listed.ended, more: listed.more });
  })
  .post("/tokens/:token/remove", vValidator("param", ONE_TOKEN, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const revoked = await revokeToken(install, actor, context.req.valid("param").token);
    if (revoked.ok) return context.json({ ok: true as const, name: revoked.token.note });

    return refused(context, revoked.code === "not_allowed" ? revoked : { code: "token_gone" });
  });
