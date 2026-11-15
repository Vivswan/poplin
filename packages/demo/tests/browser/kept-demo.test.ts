import { expect, test } from "bun:test";
import fc from "fast-check";

import { readSamples } from "../../scripts/samples";
import { openKeptDemo } from "../../src/browser/kept-demo";
import { SqlJsDriver } from "../../src/browser/sqljs-driver";
import { createPreview } from "../../src/preview/preview";
import { SQLITE } from "./support/sqlite";

/** The version the demo's installs are told they run. */
const VERSION = "1.0.0";

/** The address a visitor's browser shows the demo at. */
const HOME = "https://example.com/poplin/demo";

/** The hidden field of a form that holds its signed token. */
const FORM_TOKEN = /name="csrf" value="([^"]+)"/;

/** A demo's own pages follow the system's scheme with this declaration, until a scheme is forced. */
const FOLLOWS_SYSTEM = "color-scheme: light dark";

type Demo = Awaited<ReturnType<typeof openKeptDemo>>;

async function open(saved?: ReturnType<Demo["save"]>): Promise<Demo> {
  return openKeptDemo({ sqlite: SQLITE, samples: await readSamples(), version: VERSION, base: "/poplin/demo", saved });
}

async function page(demo: Demo, path: string): Promise<string> {
  return (await demo.fetch(new Request(`${HOME}${path}`))).text();
}

/** The dashboard page of a site, as the home page links it. */
async function sitePage(demo: Demo, name: string): Promise<string> {
  const [, path = ""] = new RegExp(`href="/poplin/demo(/sites/${name}--[^"]*)"`).exec(await page(demo, "/")) ?? [];

  return path;
}

/** Send a form as a browser hands it to a worker: with no `Origin` and no `Cookie`. */
function send(demo: Demo, path: string, token: string): Promise<Response> {
  const body = new URLSearchParams({ csrf: token }).toString();

  return demo.fetch(new Request(`${HOME}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }));
}

test("a demo opened from a save goes on where the first was, and one saved after a reset starts over: without this a worker the browser stopped comes back with other data, and a page open since before refuses its own form", async () => {
  const first = await open();
  const trashed = await sitePage(first, "checkout");
  const kept = await sitePage(first, "handbook");
  const [, token = ""] = FORM_TOKEN.exec(await page(first, kept)) ?? [];
  const sent = await send(first, `${trashed}/delete`, FORM_TOKEN.exec(await page(first, trashed))?.[1] ?? "");
  const switched = await first.fetch(new Request(`${HOME}/theme/dark?to=%2F`));

  const second = await open(first.save());
  const later = await send(second, `${kept}/delete`, token);
  const trash = await page(second, "/?view=trash");
  const dark = await page(second, "/");

  await second.fetch(new Request(`${HOME}/reset`, { method: "POST" }));
  const third = await open(second.save());

  expect([sent.status, sent.headers.get("Location")]).toEqual([303, `/poplin/demo${trashed}?done=trashed`]);
  expect([switched.status, switched.headers.get("Location")]).toEqual([303, "/poplin/demo/"]);
  expect([later.status, later.headers.get("Location")]).toEqual([303, `/poplin/demo${kept}?done=trashed`]);
  expect([trash.includes(trashed), trash.includes(kept)]).toEqual([true, true]);
  expect([(await page(first, "/")).includes(FOLLOWS_SYSTEM), dark.includes(FOLLOWS_SYSTEM)]).toEqual([false, false]);
  expect(await sitePage(third, "checkout")).not.toBe("");
  expect(await page(third, "/?view=trash")).not.toContain("/sites/checkout--");
  expect(new Set((await page(third, "/")).match(/\/sites\/handbook--[a-z0-9]+/g)).size).toBe(1);
});

test("a deep link that comes back as `?to=` is sent on to its page inside the demo: without this a forced reload of a page inside the demo ends on the home page", async () => {
  const demo = await open();
  const sentOn = async (query: string): Promise<(string | number | null)[]> => {
    const answer = await demo.fetch(new Request(`${HOME}/${query}`));

    return [answer.status, answer.headers.get("Location")];
  };

  expect(await sentOn("?to=%2Fsettings%3Fdone%3Dsaved%23content")).toEqual([302, "/poplin/demo/settings?done=saved#content"]);
  expect([await sentOn("?to=%2F..%2F"), await sentOn("?to=%2F..%2Fdemo-two%2F"), await sentOn("?view=trash")]).toEqual([
    [200, null],
    [200, null],
    [200, null],
  ]);
});

// Drift: a browser follows a redirect in more spellings than a list of patterns names. Twice a spelling got past such a list (`//host/x`, then `/a/..//host/x`) and led off the demo's origin.
test.each([
  ["at the root of its origin", ""],
  ["under a base path", "/poplin/demo"],
])("whatever `to` an address names, the demo %s redirects only to a place of its own folder", async (_, base) => {
  const demo = await openKeptDemo({ sqlite: SQLITE, samples: await readSamples(), version: VERSION, base });
  const origin = "https://example.com";
  const inside = (location: string, asked: string): boolean => {
    const target = new URL(location, asked);

    return target.origin === origin && target.pathname.startsWith(`${base}/`);
  };
  const escapes = async (path: string, to: string): Promise<string | undefined> => {
    const asked = `${origin}${base}${path}?to=${encodeURIComponent(to)}`;
    const answer = await demo.fetch(new Request(asked));
    const location = answer.headers.get("Location");

    return location === null || inside(location, asked) ? undefined : `${asked} -> ${answer.status} ${location}`;
  };
  const piece = fc.constantFrom("/", "\\", ".", "..", "%2f", "%2F", "%5c", "%2e", "\t", "\n", " ", "//", "\\\\", "/\\", "https:", "javascript:", "example.org", "@", ":", "?", "#", "a");
  const tricky = fc.array(piece, { maxLength: 8 }).map((pieces) => pieces.join(""));

  await fc.assert(
    fc.asyncProperty(fc.constantFrom("/", "/theme/dark"), fc.oneof(fc.string(), tricky, tricky.map((text) => `/${text}`)), async (path, to) => {
      expect(await escapes(path, to)).toBeUndefined();
    }),
    { numRuns: 400 },
  );

  // The control: a redirect is given at all, so the property above is not about a demo that never redirects.
  expect((await demo.fetch(new Request(`${origin}${base}/?to=%2Fsettings`))).headers.get("Location")).toBe(`${base}/settings`);
  expect((await demo.fetch(new Request(`${origin}${base}/theme/dark?to=%2Fsettings`))).headers.get("Location")).toBe(`${base}/settings`);
});

test("a served page's `Clear-Site-Data` stays inside the demo: without this the demo tells a browser to drop the cache of the whole origin, which holds the website's own pages", async () => {
  const stale = { "If-None-Match": '"v9-stale"' };
  const control = await createPreview({ openDriver: () => new SqlJsDriver(SQLITE), samples: await readSamples(), version: VERSION });
  const demo = await open();

  expect((await control.fetch(new Request("https://example.com/served/lisbon-page/", { headers: stale }))).headers.get("Clear-Site-Data")).toBe('"cache"');
  expect((await demo.fetch(new Request(`${HOME}/served/lisbon-page/`, { headers: stale }))).headers.get("Clear-Site-Data")).toBeNull();
});
