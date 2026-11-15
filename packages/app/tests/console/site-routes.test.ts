// The Sites screen's routes: what one site is answered with beside itself.

import { expect, test } from "bun:test";

import { openConsole } from "./support/console";

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
