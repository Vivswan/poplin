// The Sites screen's routes: what one site is answered with beside itself.

import { expect, test } from "bun:test";

import { NOW } from "../sites/support/install";
import { openConsole } from "./support/console";

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** What a change of a site answers, as far as these tests read it. */
interface Changed {
  readonly code?: string;
  readonly about?: string | null;
  readonly sentence?: string;
  readonly site?: { readonly expires: unknown } | null;
}

// Drift: a public site's own switch for search engines would say "Saved." while the install keeps every search engine out, and nothing at the switch would say that it changes nothing.
test("one site is answered with whether the install lets search engines in: not as an install starts, and yes once that setting is on", async () => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "public");
  const allowed = async (): Promise<unknown> => ((await (await opened.get(`/data/sites/${site.name}--${site.id}`)).json()) as { readonly search_engines_allowed: unknown }).search_engines_allowed;

  const before = await allowed();
  await opened.change("/data/settings", { texts: { search_engines_allowed: "on" } });

  expect([before, await allowed()]).toEqual([false, true]);
});

// Drift: the question that makes a site public would show an address the client put together, and a name typed as a public link ends would get that ending twice with nothing said.
test("a public name is answered with the address the install gives it, which a site made public under that name then has; a name no site may hold has none", async () => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const asked = async (name: string): Promise<unknown> => (await opened.get(`/data/public-address?name=${name}`)).json();

  const told = (await asked("guide-page")) as { readonly address: string };
  const made = await opened.change(`/data/sites/${site.name}--${site.id}/access`, { access: "public", public_name: "guide-page" });
  const refusals = [await asked("Guide"), await asked("")].map((answer) => (answer as { readonly code: string }).code);

  expect([((await made.json()) as { readonly site: { readonly url: string } }).site.url, refusals]).toEqual([told.address, ["bad_name", "bad_name"]]);
});

// Drift: a span would be counted from some other moment than the save, a day would not start in UTC, or "never" would leave the old moment in place; and the log would not say who set it.
test.each([
  ["7d", NOW + 7 * DAY_MS],
  ["2023-12-01", Date.UTC(2023, 11, 1)],
  ["never", "never"],
])("a site's expiry set to %p is answered as the moment it ends, signed by the session's admin", async (expires, moment) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  // An expiry is there first, so "never" is seen to take one away.
  await opened.change(`/data/sites/${site.name}--${site.id}/expiry`, { expires: "30d" });
  const response = await opened.change(`/data/sites/${site.name}--${site.id}/expiry`, { expires });
  const [last] = await opened.base.audit();

  expect([response.status, ((await response.json()) as Changed).site?.expires, last?.action, last?.by]).toEqual([200, moment, "details", opened.base.owner]);
});

// Drift: an expiry no rule takes would be stored, or refused with no word of the field it is about; one for a site in the trash would be set where nothing shows it.
test.each([
  ["a moment that is past", { expires: "2020-01-01" }, false, 400, "bad_argument", "expires"],
  ["a span in no known form", { expires: "soon" }, false, 400, "bad_argument", "expires"],
  ["no expiry at all", {}, false, 400, "bad_argument", "expires"],
  ["another setting beside it", { expires: "7d", name: "other" }, false, 400, "bad_argument", "name"],
  ["a site in the trash", { expires: "7d" }, true, 409, "in_trash", null],
])("a site's expiry is refused for %s, and stays as it was", async (_case, body, trashed, status, code, about) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = `${site.name}--${site.id}`;
  if (trashed) await opened.change(`/data/sites/${label}/delete`, {});

  const response = await opened.change(`/data/sites/${label}/expiry`, body);
  const refusal = (await response.json()) as Changed;
  const after = (await (await opened.get(`/data/sites/${label}`)).json()) as Changed;

  expect([response.status, refusal.code, refusal.about, after.site?.expires]).toEqual([status, code, about, "never"]);
  expect(refusal.sentence?.length).toBeGreaterThan(10);
});

// Drift: either change would be done for a request with no session, or for a body a page of another origin sends with the owner's session.
test.each([
  ["expiry", { expires: "7d" }],
])("%s is refused without a session and from another origin, and changes nothing", async (change, body) => {
  const opened = await openConsole();
  const site = await opened.base.publish("guide", "private");
  const label = `${site.name}--${site.id}`;
  const entries = (await opened.base.audit()).length;

  const loggedOut = await opened.change(`/data/sites/${label}/${change}`, body, { Cookie: "" });
  const elsewhere = await opened.change(`/data/sites/${label}/${change}`, body, { "Content-Type": "text/plain", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" });
  const after = (await (await opened.get(`/data/sites/${label}`)).json()) as Changed;

  expect([loggedOut.status, elsewhere.status, after.site?.expires, (await opened.base.audit()).length]).toEqual([401, 403, "never", entries]);
});
