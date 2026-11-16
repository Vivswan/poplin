// The data of a copy of a site. The first request refuses a name, copies a small site whole, or starts the copy of a bigger one; the client asks after that copy until it is a site.
//
//   POST /sites/<label>/duplicate   { name } begins a copy; { upload } asks after the one an earlier answer named
//   POST /copies/<upload>/cancel    gives an unfinished copy up, with its files, and stops its job

import { vValidator } from "@hono/valibot-validator";
import { cancelCopy, DUPLICATE_REQUEST, duplicateSite } from "@poplin/core/src/actions/duplicate";
import { Hono } from "hono";
import * as v from "valibot";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";

/** The calls to the database a request makes before its route runs: the one question a host reads the users and the key with, which the request is admitted by. */
const ADMIT_CALLS = 1;

/** What names the source in a route's path: its label. */
const ONE_SITE = v.object({ site: v.string() });

/** What names an unfinished copy in a route's path: the upload its answers carry. */
const ONE_COPY = v.object({ upload: v.string() });

/** The Sites screen's routes for a copy. Each request is one call of the action, which is told what admitting the request cost, so a request stays inside what a host lets one make. */
export const duplicateRoutes = new Hono<Shared>()
  .post("/sites/:site/duplicate", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", DUPLICATE_REQUEST, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const copied = await duplicateSite(install, actor, { ...context.req.valid("json"), site: context.req.valid("param").site }, ADMIT_CALLS, context.get("host").jobs);

    // `site` is `null` while files are still to copy: the client then asks again with `copy.upload`.
    return copied.ok ? context.json({ ok: true as const, site: copied.site, copy: copied.copy }) : refused(context, copied);
  })
  .post("/copies/:upload/cancel", vValidator("param", ONE_COPY, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const abandoned = await cancelCopy(install, actor, context.req.valid("param").upload, context.get("host").jobs);

    return abandoned.ok ? context.json({ ok: true as const, left: abandoned.left }) : refused(context, abandoned);
  });
