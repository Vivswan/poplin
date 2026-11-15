// The data of the Domain screen: what a token must hold, the three settings a repair carries to the domain, the last run the install remembers, and the two runs themselves.
//
//   GET  /domain             the token form's facts, the three settings, the remembered run
//   POST /domain/check       read every piece with the token in the body; changes nothing at the provider
//   POST /domain/repair      make every piece match
//   POST /domain/settings    store one or more of the three settings; the next repair carries them
//
// The token is in the body of its one request and nowhere else: no answer holds it, and nothing stores it. A console built without the provider's side has no such screen.

import { vValidator } from "@hono/valibot-validator";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { domainState } from "@poplin/core/src/actions/domain-state";
import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { SETTING_VALUES, type SettingValues } from "@poplin/core/src/records/settings";
import { type Context, Hono } from "hono";
import * as v from "valibot";

import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain/domain-run";
import type { GuardKey } from "./domain/records";
import { refused, refuseInvalid, type Shared } from "./data";
import { keptAnswer, runDone, runRefusal } from "./domain-answers";

/** The settings a repair carries to the domain, in the order the screen shows them. */
const GUARDS = ["outside_pages", "search_engines_allowed", "block_bots"] as const satisfies readonly GuardKey[];

/** What a run carries: the token, as it was pasted. */
const RUN = v.object({ token: v.string() });

/** What a change of the three settings carries: any of them, each with the value its own rule takes. */
const GUARD_CHANGES = v.partial(v.pick(SETTING_VALUES, GUARDS));

/** The three settings out of all of them. */
function guardsOf(values: SettingValues): Pick<SettingValues, GuardKey> {
  return { outside_pages: values.outside_pages, search_engines_allowed: values.search_engines_allowed, block_bots: values.block_bots };
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

    return reading.ok ? context.json(runDone(run, reading)) : context.json(runRefusal(reading.refusal), REFUSAL_STATUS[reading.refusal]);
  } catch (error) {
    // The run is kept after the plug has answered: a database that takes no more today refuses it, whatever the plug did.
    if (!(error instanceof AllowanceSpent)) throw error;

    return context.json(runRefusal("allowance_spent"), REFUSAL_STATUS.allowance_spent, { "Retry-After": String(secondsToNextDay(install.now())) });
  }
}

/** The Domain screen's data routes. Each run calls the plug once through the one function that scrubs the token, keeps the run, and writes the audit entry. */
export const domainRoutes = new Hono<Shared>()
  .get("/domain", async (context) => {
    const plug = context.get("domain");
    if (plug === undefined) return refused(context, { code: "no_page" });

    const { install, actor } = context.get("asker");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const kept = await domainState(install, actor);
    if (!kept.ok) return refused(context, kept);

    const { tokenLabel, tokenRights, tokenLink, tokenOptional, tokenNote, guardNotes } = plug;

    return context.json({
      ok: true as const,
      form: { tokenLabel, tokenRights, tokenLink, tokenOptional, tokenNote },
      guards: { values: guardsOf(config.values), notes: guardNotes },
      last: keptAnswer(kept),
    });
  })
  .post("/domain/check", vValidator("json", RUN, refuseInvalid), (context) => ran(context, "check"))
  .post("/domain/repair", vValidator("json", RUN, refuseInvalid), (context) => ran(context, "repair"))
  .post("/domain/settings", vValidator("json", GUARD_CHANGES, refuseInvalid), async (context) => {
    if (context.get("domain") === undefined) return refused(context, { code: "no_page" });

    const { install, actor } = context.get("asker");
    const changed = await changeConfig(install, actor, context.req.valid("json"));

    return changed.ok ? context.json({ ok: true as const, values: guardsOf(changed.values) }) : refused(context, changed);
  });
