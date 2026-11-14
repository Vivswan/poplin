import { expect, test } from "bun:test";

import { landing, openDashboard } from "../support/install";
import { usualPlug } from "./support/fake-plug";

const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;

test("saving stores the three domain settings through the config action, asks the plug nothing, and leaves every other setting as it was", async () => {
  const plug = usualPlug();
  const opened = await openDashboard(plug);
  const before = await opened.install.database.readSettings();
  const saved = await opened.post("/domain/save", { outside_pages: "allowed", search_engines_allowed: "on", block_bots: "on", trash_days: "99" });

  expect([saved.status, saved.headers.get("Location")]).toEqual([303, "/domain?done=saved"]);
  expect(NOTICE.exec(await landing(opened, saved))?.slice(1)).toEqual(["done", "Saved."]);
  expect(await opened.install.database.readSettings()).toEqual({
    ...before,
    outside_pages: "allowed",
    search_engines_allowed: true,
    block_bots: "on",
  } as typeof before);
  expect((await opened.audit())[0]).toMatchObject({ action: "settings_changed", by: opened.owner });
  expect(plug.calls).toEqual([]);
});

test("a value a setting does not take, or a form with a setting left out, changes nothing and names what was wrong", async () => {
  const opened = await openDashboard(usualPlug());
  const before = await opened.install.database.readSettings();
  const cases = [
    [{ outside_pages: "blocked", search_engines_allowed: "off", block_bots: "always" }, "/domain?refused=bad_argument&about=block_bots"],
    [{ outside_pages: "blocked", search_engines_allowed: "off" }, "/domain?refused=missing_field"],
  ] as const;

  for (const [fields, location] of cases) expect((await opened.post("/domain/save", fields)).headers.get("Location")).toBe(location);

  expect(await opened.install.database.readSettings()).toEqual(before);
});

test("every option the form offers is a value its setting takes: an option the settings refuse could never be saved", async () => {
  const opened = await openDashboard(usualPlug());
  const page = await (await opened.get("/domain")).text();
  const selects = [...page.matchAll(/<select id="(\w+)" name="\w+">(.*?)<\/select>/g)].map(
    (match) => [match[1] ?? "", [...(match[2] ?? "").matchAll(/>([^<]+)<\/option>/g)].map((option) => option[1] ?? "")] as const,
  );
  const usual = { outside_pages: "blocked", search_engines_allowed: "off", block_bots: "auto" };

  expect(selects.map(([key]) => key)).toEqual(Object.keys(usual));

  for (const [key, options] of selects) {
    for (const option of options)
      expect([key, option, (await opened.post("/domain/save", { ...usual, [key]: option })).headers.get("Location")]).toEqual([
        key,
        option,
        "/domain?done=saved",
      ]);
  }
});
