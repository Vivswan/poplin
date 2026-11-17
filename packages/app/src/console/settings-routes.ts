// The data of the Settings screen: every setting as a row, a save of some of them, and the sign-out of every browser.
//
//   GET  /settings                         every setting with its control, its text, its default, and the limits it can be put above: the host's free ones, and the install's own that bound it
//   POST /settings                         save some settings together, each as the text it is typed in: all of them, or on a refusal none; a refusal names every refused setting.
//                                          A saved setting the domain's rules are written from is then carried to them, on an install that holds a key
//   POST /settings/sign-everyone-out       end every login of the dashboard at the provider; a refusal says why they are not known to have ended

import { vValidator } from "@hono/valibot-validator";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { defaultSettings, RULE_SETTINGS, SETTING_VALUES, type SettingValues, settingsFromText, settingsToText, sizeBytes } from "@poplin/core/src/records/settings";
import { Hono } from "hono";
import * as v from "valibot";

import { ACCESS_SETTINGS } from "./settings/constants";
import { type FreeLimits, type FreeMark, freeLimitMarks } from "./settings/free-limits";
import { pairMarks } from "./settings/pair-limits";
import { NOTHING, refused, refuseInvalid, type Shared } from "./data";
import type { DomainPlug } from "./domain/records";
import { type Control, controlOf, screenText, unitOf } from "./setting-controls";
import { carryRules } from "./settings/rules-follow";

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

  /** Its value in the form the screen types it in, such as `9000MB`, `25%`, `on`, `never`. A save takes the same form. */
  readonly text: string;

  /** What follows the digits in the text of a number, such as `MB` or `%`; empty for a plain count and for every other setting. */
  readonly unit: string;

  /** Its default, in the form of `text`. */
  readonly fallback: string;

  /** What the setting can be put above: the host's free limits, and the install's limit that bounds it. Each is the largest count with no warning, its unit, and the sentence above it; a size has each for its text's unit and its default's. */
  readonly limits: readonly (FreeMark & { readonly unit: string })[];

  /** `true` for a setting a repair carries to the provider, in a dashboard that has the Domain screen, where that half waits for the next repair. `false` for one the install carries there by itself, or that no repair carries. */
  readonly repair: boolean;

  /** What the setting needs before it does anything on this install, in one short line; `null` for a setting that works. Its control takes no change while it says so. */
  readonly needs: string | null;
}

/** Every setting's text as the screen types it. */
function screenTexts(values: SettingValues): Readonly<Record<Key, string>> {
  const texts = settingsToText(values);
  for (const key of Object.keys(texts) as Key[]) texts[key] = screenText(SETTING_VALUES.entries[key], values[key], texts[key]);

  return texts;
}

/**
 * The marks of a setting on the count it is typed with, for each unit a text of the row can have: its own, and its default's, which Reset puts into the field.
 *
 * A size's bytes become a count of the unit, rounded down, so a typed count is above the mark exactly when its bytes are.
 */
function limitsOf(marks: readonly FreeMark[], value: SettingValues[Key], texts: readonly string[]): Row["limits"] {
  const units = [...new Set(texts.map((text) => text.replace(/^\d+/, "")))];
  const size = typeof value === "object" && !Array.isArray(value);

  return units.flatMap((unit) => {
    const one = size ? sizeBytes({ count: 1, unit } as SettingValues["max_total_size"]) : 1;

    return marks.map((mark) => ({ over: Math.floor(mark.over / one), unit, warning: mark.warning }));
  });
}

/** Whether the install carries a setting to the domain by itself: one the domain's rules are written from, on an install that holds a key. */
function isCarried(key: Key, carries: boolean): boolean {
  return carries && (RULE_SETTINGS as readonly Key[]).includes(key);
}

/**
 * The rows of the screen.
 *
 * @param facts - the host's free limits; the provider's side of the install, absent in a dashboard with no Domain screen, which says the settings a repair carries and the idle ones; and whether the install carries the rules' settings by itself
 */
function rowsOf(values: SettingValues, facts: { readonly freeLimits: FreeLimits; readonly domain: Pick<DomainPlug, "carriedSettings" | "idleSettings"> | undefined; readonly carries: boolean }): readonly Row[] {
  const texts = screenTexts(values);
  const [installer] = values.logins;
  const defaults = installer === undefined ? texts : screenTexts(defaultSettings({ installer }));
  const [free, pairs] = [freeLimitMarks(values, facts.freeLimits), pairMarks(values)];
  const shown = (Object.keys(texts) as Key[]).filter((key) => !ACCESS_SETTINGS.includes(key));
  const carried: readonly string[] = facts.domain?.carriedSettings ?? [];
  const idle: Readonly<Record<string, string | undefined>> = facts.domain?.idleSettings ?? {};

  return shown.map((key) => {
    const control = controlOf(SETTING_VALUES.entries[key]);

    return {
      key,
      control,
      text: texts[key],
      unit: control.kind === "number" ? unitOf(SETTING_VALUES.entries[key], texts[key]) : "",
      fallback: defaults[key],
      limits: limitsOf([...(free[key] ?? []), ...(pairs[key] ?? [])], values[key], [texts[key], defaults[key]]),
      repair: carried.includes(key) && !isCarried(key, facts.carries),
      needs: idle[key] ?? null,
    };
  });
}

/** The code a refused setting is answered with: the pair of the update settings has one of its own, and any other is a value its setting does not take. */
function codeOf(refused: { readonly refusal: string }): string {
  return refused.refusal === "needs-update-check" ? "needs_update_check" : "bad_argument";
}

/** The Settings screen's data routes. */
export const settingsRoutes = new Hono<Shared>()
  .get("/settings", async (context) => {
    const { install, actor } = context.get("asker");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const rows = rowsOf(config.values, { freeLimits: context.get("host").freeLimits, domain: context.get("domain"), carries: context.get("rules")?.holdsKey() === true });

    return context.json({ ok: true as const, rows });
  })
  .post("/settings", vValidator("json", SAVE, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { texts } = context.req.valid("json");
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    const current = settingsToText(config.values);
    const held = Object.keys(texts).filter((key): key is Key => Object.hasOwn(current, key) && !ACCESS_SETTINGS.includes(key as Key));
    const stranger = Object.keys(texts).find((key) => !held.includes(key as Key));
    if (stranger !== undefined) return refused(context, { code: "bad_argument", about: stranger });

    // A setting is read from its text beside every other one, so the settings the save leaves out go along as they are stored and are not sent on.
    const read = settingsFromText({ ...current, ...texts });
    // Every refused text is answered at once, so the screen marks each field at the first Save.
    if (!read.ok) return refused(context, { code: codeOf(read), about: read.key, each: read.every.map((refusal) => ({ code: codeOf(refusal), about: refusal.key })) });

    const changed = await changeConfig(install, actor, Object.fromEntries(held.map((key) => [key, read.values[key]])));
    if (!changed.ok) return refused(context, changed);

    if (held.some((key) => isCarried(key, true))) await carryRules(context, install, context.get("rules"));

    return context.json({ ok: true as const });
  })
  .post("/settings/sign-everyone-out", vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const signedOut = await signEveryoneOut(install, actor, context.get("endLogins"));

    return signedOut.ok ? context.json({ ok: true as const }) : refused(context, signedOut);
  });
