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
