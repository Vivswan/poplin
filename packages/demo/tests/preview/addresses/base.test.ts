import { expect, test } from "bun:test";

import { createClient } from "../../../../cli/src/client/client";
import { PUBLISHED_SITE } from "../../../../core/src/actions/publish/finish-publish";
import { BEGUN_UPLOAD } from "../../../../core/src/actions/publish/uploads";
import { sha256Of } from "../../../../core/src/storage/storage";
import { readSamples } from "../../../scripts/samples";
import { SqlJsDriver } from "../../../src/browser/sqljs-driver";
import { rebased, unbased } from "../../../src/preview/addresses/base";
import { createPreview } from "../../../src/preview/preview";
import { SQLITE } from "../../browser/support/sqlite";

/** The path a host serves the demo under. */
const BASE = "/poplin/demo";

/** The origin the browser asks. */
const ORIGIN = "https://example.com";

/** A ticket as the install's own route hands one out: its address is a path from the install's root. */
const TICKET = { path: "css/site.css", url: "/api/uploads/0123456789abcdef/file?path=css%2Fsite.css", method: "PUT", headers: { "Content-Length": "6" }, expires: 1_700_086_400_000 };

/** A ticket for another place, whose address is whole. */
const ELSEWHERE = { ...TICKET, path: "index.html", url: "https://files.example.net/drop/index.html?leave=1" };

/** How long the test that seeds a preview may take, in milliseconds: a seed is work of the processor alone, and a busy machine takes it past the five seconds a test gets. */
const SEED_MS = 30_000;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// Drift: a ticket names where a file is sent, as a path from the install's root. Under a base path that root is not the demo's: a file sent there met "Not found", and every publish into a demo under a folder failed.
test.each([
  ["a begun upload", { upload: { id: "0123456789abcdef", state: "pending" }, tickets: [TICKET, ELSEWHERE] }],
  ["a call for tickets", { tickets: [TICKET, ELSEWHERE] }],
])("the ticket of %s names a path under the base, which leads back to the route the ticket was made for, and a whole address is left alone", async (_what, body) => {
  const answered = (await (await rebased(json(body), BASE, ORIGIN)).json()) as { tickets: { url: string }[] };
  const followed = await unbased(new Request(new URL(answered.tickets[0]?.url ?? "", ORIGIN), { method: "PUT", body: "body{}" }), BASE);
  const back = followed === undefined ? undefined : new URL(followed.url);

  expect([answered, back === undefined ? "outside the base" : `${back.pathname}${back.search}`]).toEqual([
    { ...body, tickets: [{ ...TICKET, url: `${BASE}${TICKET.url}` }, ELSEWHERE] },
    TICKET.url,
  ]);
});

// Drift: every answer called JSON passes here, a served site's own files among them. One that is no JSON at all threw, and the site's file was answered as a failure of the preview.
test("a JSON answer that holds no ticket, or text where its tickets go, and a file called JSON that is none, are answered as they were", async () => {
  const bodies = [{ sites: [{ url: "/api/uploads/x/file" }] }, { tickets: "none" }, { tickets: [{ url: 7 }] }];
  const answered = await Promise.all(bodies.map(async (body) => (await rebased(json(body), BASE, ORIGIN)).json()));
  const broken = await rebased(new Response("{bad", { headers: { "Content-Type": "application/json" } }), BASE, ORIGIN);

  expect([answered, broken.status, await broken.text()]).toEqual([bodies, 200, "{bad"]);
});

// Drift: the unit above holds the answer's form. This holds the whole way: a client that reaches the preview under a folder begins a publish, sends the file where its ticket says, and finishes.
test("a client that reaches a preview under a base path publishes a page by its ticket", async () => {
  const preview = await createPreview({ openDriver: () => new SqlJsDriver(SQLITE), samples: await readSamples(), version: "1.0.0", base: BASE, client: { entry: async () => ({ script: "app.js", style: "app.css" }), file: async () => undefined } });
  const client = createClient({ server: `${ORIGIN}${BASE}`, token: preview.token(), fetch: (input, init) => preview.fetch(new Request(input, init)) });
  const page = new TextEncoder().encode("<title>Under a folder</title>");
  const files = [{ path: "index.html", size: page.length, content_type: "text/html", sha256: await sha256Of(page) }];

  const begun = await client.call(BEGUN_UPLOAD, (api) => api.uploads.$post({ json: { name: "folder", files } }));
  if (!begun.ok) throw new Error(`the publish did not begin: ${JSON.stringify(begun.failure)}`);

  const ticket = begun.value.tickets?.[0];
  const sent = ticket === undefined ? undefined : await client.send(ticket, page);
  const finished = await client.call(PUBLISHED_SITE, (api) => api.uploads[":upload"].finish.$post({ param: { upload: begun.value.upload.id } }));

  expect<unknown>([ticket?.url.startsWith(`${BASE}/api/uploads/`), sent, finished.ok && finished.value.site.name]).toEqual([true, { ok: true, value: undefined }, "folder"]);
}, SEED_MS);
