// The data of the Domain screen: what a token must hold, the last run the install remembers, and the two runs themselves.
//
//   GET  /domain             the token form's facts, how the screen names the provider's side of this install, the remembered run, and whether the users changed since the last repair, on an install that does not carry them by itself
//   POST /domain/check       read every piece with the token in the body; changes nothing at the provider
//   POST /domain/repair      make every piece match, with the stored settings a repair carries to the domain
//
// The token is in the body of its one request and nowhere else: no answer holds it, and nothing stores it. A console built without the provider's side has no such screen.

import { vValidator } from "@hono/valibot-validator";
import { readConfig } from "@poplin/core/src/actions/config";
import { domainState } from "@poplin/core/src/actions/domain-state";
import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { type Context, Hono } from "hono";
import * as v from "valibot";

import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain/domain-run";
import { refused, refuseInvalid, type Shared } from "./data";
import { keptAnswer, runDone, runRefusal } from "./domain-answers";

/** What a run carries: the token, as it was pasted. */
const RUN = v.object({ token: v.string() });

/** Whether a change of the users is carried to the domain with no person: one that waits is then nothing the screen asks a repair for. */
function selfCarried(context: Context<Shared>): boolean {
  return context.get("follow")?.holdsKey() === true;
}

/** Run the plug once for the token a request carries, and answer the rows or the refusal. */
async function ran(context: Context<Shared, string, { out: { json: v.InferOutput<typeof RUN> } }>, run: DomainRun) {
  const plug = context.get("domain");
  if (plug === undefined) return refused(context, { code: "no_page" });

  const { install, actor } = context.get("asker");
  const config = await readConfig(install, actor);
  if (!config.ok) return refused(context, config);

  try {
    const reading = await runDomain(plug, install, { run, token: context.req.valid("json").token, settings: async () => config.values, by: actor.holder, from: "dashboard" });

    if (!reading.ok) return context.json(runRefusal(reading.refusal, plug.tokenFor), REFUSAL_STATUS[reading.refusal]);

    const kept = await domainState(install, actor);

    return context.json(runDone(run, reading, kept.ok && kept.waits && !selfCarried(context)));
  } catch (error) {
    // The run is kept after the plug has answered: a database that takes no more today refuses it, whatever the plug did.
    if (!(error instanceof AllowanceSpent)) throw error;

    return context.json(runRefusal("allowance_spent", plug.tokenFor), REFUSAL_STATUS.allowance_spent, { "Retry-After": String(secondsToNextDay(install.now())) });
  }
}

/** The Domain screen's data routes. Each run calls the plug once through the one function that scrubs the token, keeps the run, and writes the audit entry. */
export const domainRoutes = new Hono<Shared>()
  .get("/domain", async (context) => {
    const plug = context.get("domain");
    if (plug === undefined) return refused(context, { code: "no_page" });

    const { install, actor } = context.get("asker");
    const kept = await domainState(install, actor);
    if (!kept.ok) return refused(context, kept);

    const { tokenRights, tokenLink, tokenOptional, tokenNote, words } = plug;

    return context.json({ ok: true as const, form: { tokenRights, tokenLink, tokenOptional, tokenNote }, words: { thing: words.thing, line: words.line }, last: keptAnswer({ ...kept, waits: kept.waits && !selfCarried(context) }) });
  })
  .post("/domain/check", vValidator("json", RUN, refuseInvalid), (context) => ran(context, "check"))
  .post("/domain/repair", vValidator("json", RUN, refuseInvalid), (context) => ran(context, "repair"));
