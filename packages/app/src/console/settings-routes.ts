// The data of the Settings screen: every setting as a row, a save of some of them, the address that starts a rebuild, and the sign-out of every browser.
//
//   GET  /settings                         every setting with its control, its text, its default, and its warning; and whether a rebuild address is saved
//   POST /settings                         save some settings, each as the text it is typed in
//   POST /settings/update-address          save the address that starts a rebuild
//   POST /settings/update-address/remove   remove it
//   POST /settings/sign-everyone-out       end every session, this one included

import { vValidator } from "@hono/valibot-validator";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { removeUpdateAddress, saveUpdateAddress, UPDATE_ADDRESS_REQUEST, updateAddressState } from "@poplin/core/src/actions/update-address";
import { defaultSettings, SETTING_VALUES, type SettingValues, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";
import { Hono } from "hono";
import * as v from "valibot";

import { DOMAIN_SETTINGS } from "../dashboard/settings/constants";
import { type FreeLimits, freeLimitWarnings } from "../dashboard/settings/free-limits";
import { NOTHING, refused, refuseInvalid, type Shared } from "./data";
import { type Control, controlOf } from "./setting-controls";

/** The default of the one setting whose default depends on who set the install up. */
const DEFAULT_LOGINS = "The email of whoever set the install up";

/** What a save carries: the text of each setting it changes, by the setting's key. */
const SAVE = v.object({ texts: v.record(v.string(), v.string()) });

/** A setting's key. */
type Key = keyof SettingValues;

/** One setting as the screen shows it. */
interface Row {
  /** Its key, as `poplin config` names it. */
  readonly key: Key;

  /** What it is changed with. */
  readonly control: Control;

  /** Its value in the form it is typed in, such as `9GB`, `25%`, `on`. */
  readonly text: string;

  /** What follows the digits in the text of a number, such as `%`; empty for every other setting. */
  readonly suffix: string;

  /** Its default, as shown. */
  readonly fallback: string;

  /** Whether its value is another than the default. */
  readonly changed: boolean;

  /** The host's sentence for a value above a limit of its free plan, or `null`. */
  readonly warning: string | null;

  /** `true` for a setting that also changes rules on the domain: it is shown here and changed where the domain is. */
  readonly elsewhere: boolean;
}

function rowsOf(values: SettingValues, hostname: string, freeLimits: FreeLimits): readonly Row[] {
  const texts = settingsToText(values);
  const [installer] = values.logins;
  const defaults = installer === undefined ? texts : settingsToText(defaultSettings({ installer, hostname }));
  const warnings = freeLimitWarnings(values, freeLimits);

  return (Object.keys(texts) as Key[]).map((key) => {
    const value = values[key];

    return {
      key,
      control: controlOf(SETTING_VALUES.entries[key]),
      text: texts[key],
      suffix: typeof value === "number" ? texts[key].slice(String(value).length) : "",
      fallback: key === "logins" ? DEFAULT_LOGINS : defaults[key],
      changed: texts[key] !== defaults[key],
      warning: warnings.get(key) ?? null,
      elsewhere: DOMAIN_SETTINGS.includes(key),
    };
  });
}

/** The Settings screen's data routes. */
export const settingsRoutes = new Hono<Shared>()
  .get("/settings", async (context) => {
    const { install, actor } = context.get("asker");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const address = await updateAddressState(install, actor);
    if (!address.ok) return refused(context, address);

    const rows = rowsOf(config.values, new URL(context.req.url).hostname, context.get("host").freeLimits);

    return context.json({ ok: true as const, rows, updateAddress: { set: address.set, since: address.since } });
  })
  .post("/settings", vValidator("json", SAVE, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { texts } = context.req.valid("json");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const current = settingsToText(config.values);
    const held = Object.keys(texts).filter((key): key is Key => Object.hasOwn(current, key) && !DOMAIN_SETTINGS.includes(key as Key));
    const stranger = Object.keys(texts).find((key) => !held.includes(key as Key));
    if (stranger !== undefined) return refused(context, { code: "bad_argument", about: stranger });

    // A setting is read from its text beside every other one, so the settings the save leaves out go along as they are stored and are not sent on.
    const read = settingsFromText({ ...current, ...texts });
    if (!read.ok) return refused(context, { code: "bad_argument", about: read.key });

    const changed = await changeConfig(install, actor, Object.fromEntries(held.map((key) => [key, read.values[key]])));
    if (!changed.ok) return refused(context, changed);

    // The login in front of the dashboard keeps a list of its own, which only a repair of the domain brings up to the stored one.
    return context.json({ ok: true as const, loginsChanged: changed.values.logins.join() !== config.values.logins.join() });
  })
  .post("/settings/update-address", vValidator("json", UPDATE_ADDRESS_REQUEST, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const saved = await saveUpdateAddress(install, actor, context.req.valid("json").address, context.get("host").rebuilding.accepts);

    return saved.ok ? context.json({ ok: true as const, set: saved.set, since: saved.since }) : refused(context, saved);
  })
  .post("/settings/update-address/remove", vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const removed = await removeUpdateAddress(install, actor);

    return removed.ok ? context.json({ ok: true as const, set: removed.set, since: removed.since }) : refused(context, removed);
  })
  .post("/settings/sign-everyone-out", vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const signedOut = await signEveryoneOut(install, actor);

    return signedOut.ok ? context.json({ ok: true as const }) : refused(context, signedOut);
  });
