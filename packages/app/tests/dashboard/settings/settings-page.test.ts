import { expect, test } from "bun:test";

import { changeConfig } from "@poplin/core/src/actions/config";
import { settingsToText } from "@poplin/core/src/records/settings";

import { openDashboard } from "../support/install";

const ZONE = ["outside_pages", "search_engines_allowed", "block_bots"];
const INPUT = /<input type="text" id="([a-z_]+)" name="([a-z_]+)" value="([^"]*)" autocomplete="off">\s*<p class="hint">Default: ([^<]*)<\/p>/g;

test("every ordinary setting has a labelled input holding its stored text and shows its default; the Domain tab's settings are text only", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;
  await changeConfig(opened.install, admin, { trash_days: 30, dashboard_title: `Ada's "sites" <b>`, gallery: true, max_sites: 12 });

  const stored = await opened.install.database.readSettings();
  if (stored === undefined) throw new Error("the settings are not stored");

  const texts = settingsToText(stored);
  const page = await (await opened.get("/settings")).text();
  const inputs = Array.from(page.matchAll(INPUT), ([, id, name, value, fallback]) => ({ id, name, value, fallback }));
  const ordinary = Object.keys(texts).filter((key) => !ZONE.includes(key));

  expect(inputs.map((input) => input.name)).toEqual(ordinary);
  expect(inputs.every((input) => input.id === input.name && page.includes(`<label for="${input.id}"><code>${input.id}</code></label>`))).toBe(true);
  expect(Object.fromEntries(inputs.map((input) => [input.name, input.value]))).toMatchObject({
    trash_days: "30",
    dashboard_title: "Ada&#39;s &quot;sites&quot; &lt;b&gt;",
    gallery: "on",
    max_sites: "12",
    max_total_size: "9GB",
    logins: "owner@example.com",
  });
  expect(Object.fromEntries(inputs.map((input) => [input.name, input.fallback]))).toMatchObject({
    trash_days: "7",
    dashboard_title: "poplin.example.com",
    gallery: "off",
    max_sites: "none",
    logins: "the email of whoever set the install up",
  });
  expect(page).toContain("so they are changed on the Domain tab.");
  expect(page).toContain("<dt><code>outside_pages</code></dt><dd>blocked</dd><dt><code>search_engines_allowed</code></dt><dd>off</dd><dt><code>block_bots</code></dt><dd>auto</dd>");
  expect(page).toContain(`<title>Settings - Ada&#39;s &quot;sites&quot; &lt;b&gt;</title>`);
});

test("a stored value above a free limit shows its warning beside its own field, on every visit, and no other field shows one", async () => {
  const opened = await openDashboard();
  const admin = { scope: "admin", holder: opened.owner } as const;

  expect(await (await opened.get("/settings")).text()).not.toContain("Warning:");

  await changeConfig(opened.install, admin, { max_total_size: { count: 20, unit: "GB" }, requests_per_day: 250_000 });
  const page = await (await opened.get("/settings")).text();

  expect(page.match(/<p class="warning" id="[a-z_]+-warning"><strong>Warning:<\/strong> [^<]*<\/p>/g)).toEqual([
    '<p class="warning" id="max_total_size-warning"><strong>Warning:</strong> above Cloudflare&#39;s free 10 GB; storage past that is billed by Cloudflare</p>',
    '<p class="warning" id="requests_per_day-warning"><strong>Warning:</strong> above Cloudflare&#39;s free 100,000 requests a day; has no effect without the paid Workers plan</p>',
  ]);
});
