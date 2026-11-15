import { expect, test } from "bun:test";

import { type SettingValues, settingsToText } from "@poplin/core/src/records/settings";

import { LOGIN, landing, type Opened, openDashboard } from "../support/install";

const ZONE = ["outside_pages", "search_engines_allowed", "block_bots"];
const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;

async function settings(opened: Opened): Promise<SettingValues> {
  const stored = await opened.install.database.readSettings();
  if (stored === undefined) throw new Error("the settings are not stored");

  return stored;
}

/** The fields the Settings form sends: every ordinary setting's stored text, with `changes` typed over them. */
async function fields(opened: Opened, changes: Readonly<Record<string, string>> = {}): Promise<Record<string, string>> {
  const texts: Record<string, string> = settingsToText(await settings(opened));
  for (const key of ZONE) delete texts[key];

  return { ...texts, ...changes };
}

test("saving sends the typed values through the config action: the changed keys change, one audit entry names them, and the page says saved, with the one more step when the logins changed", async () => {
  const opened = await openDashboard();
  const before = await settings(opened);

  const saved = await opened.post("/settings/save", await fields(opened, { trash_days: "30", default_search_engines: "on", logins: "owner@example.com,Ada@Example.com", dashboard_title: "My sites" }));

  // Drift: the provider's login keeps its own list of emails; a page that only said "Saved." would leave a new person stopped there with nothing saying why.
  expect([saved.status, saved.headers.get("Location")]).toEqual([303, "/settings?done=saved_logins"]);
  expect(NOTICE.exec(await landing(opened, saved))?.slice(1)).toEqual(["done", "Saved. One more step: open the Domain tab, paste a token, and press Repair. Until then the login page lets in only the emails it had before."]);
  expect(await settings(opened)).toEqual({ ...before, trash_days: 30, default_search_engines: true, logins: ["owner@example.com", "ada@example.com"] as SettingValues["logins"], dashboard_title: "My sites" });
  expect((await opened.audit())[0]).toMatchObject({ action: "settings_changed", by: opened.owner });

  const entries = (await opened.audit()).length;
  const again = await opened.post("/settings/save", await fields(opened));

  expect(again.headers.get("Location")).toBe("/settings?done=saved");
  expect((await opened.audit()).length).toBe(entries);
});

test("an admin who takes their own email out of the logins is refused and nothing changes: the session ends at once and the login page knows no new email until a repair, so nobody could get back in", async () => {
  const opened = await openDashboard();
  const before = await settings(opened);

  const saved = await opened.post("/settings/save", await fields(opened, { logins: "second@example.com" }));

  expect(saved.headers.get("Location")).toBe("/settings?refused=no_working_login&about=logins");
  expect(NOTICE.exec(await landing(opened, saved))?.slice(1)).toEqual(["refused", "Your own email has to stay in the logins, so nothing was changed. Another admin can take it out."]);
  expect(await settings(opened)).toEqual(before);
});

test("a value above a free limit is saved, never blocked, and the page it lands on warns beside that field", async () => {
  const opened = await openDashboard();

  const saved = await opened.post("/settings/save", await fields(opened, { max_total_size: "50GB", requests_per_day: "1000000" }));
  const page = await landing(opened, saved);

  expect(saved.headers.get("Location")).toBe("/settings?done=saved");
  expect(await settings(opened)).toMatchObject({ max_total_size: { count: 50, unit: "GB" }, requests_per_day: 1_000_000 });
  expect(page.match(/id="[a-z_]+-warning"/g)).toEqual(['id="max_total_size-warning"', 'id="requests_per_day-warning"']);
});

test("text a setting does not take, a missing field, and a form that names a Domain tab setting change nothing; the refusal names the setting", async () => {
  const opened = await openDashboard();
  const before = JSON.stringify([await settings(opened), await opened.audit()]);
  const withoutOne = await fields(opened);
  delete withoutOne.trash_days;
  const refusals = [
    [await fields(opened, { trash_days: "soon" }), "/settings?refused=bad_argument&about=trash_days", "Use a whole number, 1 or more."],
    [await fields(opened, { trash_days: "0" }), "/settings?refused=bad_argument&about=trash_days", "Use a whole number, 1 or more."],
    [await fields(opened, { max_total_size: "9 GB" }), "/settings?refused=bad_argument&about=max_total_size", "Use a size such as 200MB or 9GB."],
    [await fields(opened, { logins: "" }), "/settings?refused=bad_argument&about=logins", "Use whole email addresses, each one once."],
    [await fields(opened, { logins: "<script>" }), "/settings?refused=bad_argument&about=logins", "Use whole email addresses, each one once."],
    [await fields(opened, { trash_days: " 30 " }), "/settings?refused=bad_argument&about=trash_days", "Use a whole number, 1 or more."],
    [await fields(opened, { dashboard_title: "" }), "/settings?refused=bad_argument&about=dashboard_title", "Type a title."],
    [await fields(opened, { site_share_of_day: "101%" }), "/settings?refused=bad_argument&about=site_share_of_day", "Use a whole number from 1 to 100."],
    [withoutOne, "/settings?refused=missing_field", "The form was incomplete, so nothing was changed."],
    [{}, "/settings?refused=missing_field", "The form was incomplete, so nothing was changed."],
  ] as const;

  for (const [form, location, sentence] of refusals) {
    const answer = await opened.post("/settings/save", form);

    expect([answer.status, answer.headers.get("Location")]).toEqual([303, location]);
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", sentence]);
  }

  const zone = await opened.post("/settings/save", await fields(opened, { outside_pages: "allowed", search_engines_allowed: "on", block_bots: "off", no_such_setting: "1" }));

  expect(zone.headers.get("Location")).toBe("/settings?done=saved");
  expect(JSON.stringify([await settings(opened), await opened.audit()])).toBe(before);
});

test("sign everyone out needs its box ticked; ticked, the signing key is replaced, one audit entry is written, and the owner's own session ends", async () => {
  const opened = await openDashboard();
  const key = String(await opened.install.database.readSigningKey());
  const entries = (await opened.audit()).length;

  const unticked: readonly Record<string, string>[] = [{}, { confirm: "no" }, { confirm: "" }];

  for (const form of unticked) {
    const answer = await opened.post("/settings/sign-everyone-out", form);

    expect(answer.headers.get("Location")).toBe("/settings?refused=not_confirmed");
    expect(NOTICE.exec(await landing(opened, answer))?.slice(1)).toEqual(["refused", "The box was not ticked, so nothing was changed."]);
  }

  expect([String(await opened.install.database.readSigningKey()), (await opened.audit()).length]).toEqual([key, entries]);

  const signedOut = await opened.post("/settings/sign-everyone-out", { confirm: "yes" });
  const after = await opened.get("/settings");

  expect([signedOut.status, signedOut.headers.get("Location")]).toEqual([303, `${LOGIN}${encodeURIComponent("/")}`]);
  expect(String(await opened.install.database.readSigningKey())).not.toBe(key);
  expect((await opened.audit()).slice(0, -entries).map((entry) => [entry.action, entry.by])).toEqual([["signed_everyone_out", opened.owner]]);
  expect([after.status, after.headers.get("Location"), await after.text()]).toEqual([302, `${LOGIN}${encodeURIComponent("/settings")}`, ""]);
});
