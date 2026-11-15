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

/** A stand-in for the dashboard's built client, which a browser's host serves as files. */
const CLIENT: Parameters<typeof openKeptDemo>[0]["client"] = {
  entry: async () => ({ script: "app-test.js", style: "app-test.css" }),
  file: async (name) => (name === "app-test.js" ? { body: "// the client", type: "text/javascript; charset=utf-8" } : undefined),
};

type Demo = Awaited<ReturnType<typeof openKeptDemo>>;

async function open(saved?: ReturnType<Demo["save"]>): Promise<Demo> {
  return openKeptDemo({ sqlite: SQLITE, samples: await readSamples(), version: VERSION, base: "/poplin/demo", client: CLIENT, saved });
}

/** The labels of the sites a list of the dashboard holds, by their names. */
async function labels(demo: Demo, query = ""): Promise<Readonly<Record<string, string>>> {
  const { sites } = (await (await demo.fetch(new Request(`${HOME}/data/sites${query}`))).json()) as { sites: readonly { readonly name: string; readonly label: string }[] };

  return Object.fromEntries(sites.map((site) => [site.name, site.label]));
}

/** Send a change as a browser hands it to a worker: the client's JSON, with no `Origin` and no `Cookie`. */
function send(demo: Demo, path: string): Promise<Response> {
  return demo.fetch(new Request(`${HOME}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
}

test("a demo opened from a save goes on where the first was, takes a change from a page open since before, and one saved after a reset starts over: without this a worker the browser stopped comes back with other data", async () => {
  const first = await open();
  const seeded = await labels(first);
  const sent = await send(first, `/data/sites/${seeded.checkout}/delete`);

  const second = await open(first.save());
  const later = await send(second, `/data/sites/${seeded.handbook}/delete`);
  const trash = await labels(second, "?view=trash");

  await second.fetch(new Request(`${HOME}/reset`, { method: "POST" }));
  const third = await open(second.save());
  const again = await labels(third);

  expect([sent.status, later.status]).toEqual([200, 200]);
  expect([trash.checkout, trash.handbook]).toEqual([seeded.checkout, seeded.handbook]);
  expect([again.checkout === undefined, again.checkout === seeded.checkout, Object.keys(await labels(third, "?view=trash")).includes("checkout")]).toEqual([false, false, false]);
});

// Drift: the page the worker answers names the client's files under the demo's own folder, and the worker hands each out from its host. A page that named them at the origin's root would load no script on a host that keeps the demo under a path.
test("the dashboard's page links the client's files under the demo's folder, and the demo answers them from what its host hands it", async () => {
  const demo = await open();
  const page = await (await demo.fetch(new Request(`${HOME}/empty/`))).text();
  const script = await demo.fetch(new Request(`${HOME}/empty/assets/app-test.js`));

  expect(page).toContain('<script type="module" src="/poplin/demo/empty/assets/app-test.js"></script>');
  expect(page).toContain('"base":"/poplin/demo/empty"');
  expect([script.status, await script.text(), (await demo.fetch(new Request(`${HOME}/assets/other.js`))).status]).toEqual([200, "// the client", 404]);
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
  const demo = await openKeptDemo({ sqlite: SQLITE, samples: await readSamples(), version: VERSION, base, client: CLIENT });
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
    fc.asyncProperty(fc.oneof(fc.string(), tricky, tricky.map((text) => `/${text}`)), async (to) => {
      expect(await escapes("/", to)).toBeUndefined();
    }),
    { numRuns: 400 },
  );

  // The control: a redirect is given at all, so the property above is not about a demo that never redirects.
  expect((await demo.fetch(new Request(`${origin}${base}/?to=%2Fsettings`))).headers.get("Location")).toBe(`${base}/settings`);
});

test("a served page's `Clear-Site-Data` stays inside the demo: without this the demo tells a browser to drop the cache of the whole origin, which holds the website's own pages", async () => {
  const stale = { "If-None-Match": '"v9-stale"' };
  const control = await createPreview({ openDriver: () => new SqlJsDriver(SQLITE), samples: await readSamples(), version: VERSION, client: CLIENT });
  const demo = await open();

  expect((await control.fetch(new Request("https://example.com/served/lisbon-page/", { headers: stale }))).headers.get("Clear-Site-Data")).toBe('"cache"');
  expect((await demo.fetch(new Request(`${HOME}/served/lisbon-page/`, { headers: stale }))).headers.get("Clear-Site-Data")).toBeNull();
});
