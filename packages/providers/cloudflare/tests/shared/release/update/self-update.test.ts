// An install replacing its own code with a release, against a website, a release's page, and a Cloudflare API that are all stand-ins.
// Without these the Worker could run bytes the project never published, lose a binding or its key in an update, or say the key's value in an answer.

import { describe, expect, spyOn, test } from "bun:test";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { releaseDigest } from "@poplin/core/src/records/release";
import { homepage } from "../../../../../../cli/package.json";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../../../src/shared/release/publish/bundle-manifest";
import { bundleAddress, MANIFEST_FILE } from "../../../../src/shared/release/publish/release-source";
import { readKeptKey } from "../../../../src/shared/install/key/kept-key";
import { createSelfUpdate } from "../../../../src/shared/release/update/self-update";
import { refusal, reply } from "../../install/support/replies";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The Worker that is replaced. */
const WORKER = { accountId: "0123456789abcdef0123456789abcdef", script: "poplin" };

/** The clock of every update here. */
const NOW = Date.UTC(2026, 11, 1, 12);

/** Where the stand-in for Cloudflare's API is. */
const API = "http://localhost/client/v4";

/** The paths of the Worker at the API. */
const SCRIPT = `/client/v4/accounts/${WORKER.accountId}/workers/scripts/${WORKER.script}`;

/** The calls an update makes, as the stand-in records them. */
const [READ_CRONS, READ_BINDINGS, UPLOAD, SET_CRONS] = [`GET ${SCRIPT}/schedules`, `GET ${SCRIPT}/settings`, `PUT ${SCRIPT}?bindings_inherit=strict`, `PUT ${SCRIPT}/schedules`];

/** The file of the project's website that names the releases. */
const PINS = new URL("releases.json", homepage).href;

/** Turns a text into the bytes of a file. */
const ENCODER = new TextEncoder();

/** A built module and its map, as any bytes. */
const [MODULE, MAP] = [ENCODER.encode('export default { fetch: () => new Response("0.3.0") };\n//# sourceMappingURL=worker.js.map\n'), ENCODER.encode('{"version":3,"sources":[],"mappings":""}')];

/** The observability a release states. */
const OBSERVABILITY = { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } };

/** The configuration a release is built from, with one of each thing the manifest states. */
const CONFIG = {
  name: "poplin",
  main: "packages/providers/cloudflare/src/shared/worker/worker.ts",
  compatibility_date: "2026-11-01",
  minify: true,
  upload_source_maps: true,
  observability: OBSERVABILITY,
  build: { command: "bun run built-client" },
  triggers: { crons: ["*/15 * * * *"] },
  r2_buckets: [{ binding: "SITES", bucket_name: "poplin-sites" }],
  d1_databases: [{ binding: "DB", database_name: "poplin" }],
  ratelimits: [{ name: "MINUTE_LIMITS", namespace_id: "1001", simple: { limit: 1_000_000, period: 60 } }],
  workflows: [{ name: "poplin-jobs", binding: "JOBS", class_name: "PoplinJobs" }],
  vars: { WORKER_NAME: "poplin" },
};

/** Every binding a set-up install's Worker has, as Cloudflare lists them. */
const BINDINGS = [
  { name: "SITES", type: "r2_bucket" },
  { name: "DB", type: "d1" },
  { name: "JOBS", type: "workflow" },
  { name: "MINUTE_LIMITS", type: "ratelimit" },
  { name: "WORKER_NAME", type: "plain_text" },
  { name: "ACCOUNT_ID", type: "plain_text" },
  { name: "ZONE", type: "json" },
  { name: "ACCESS", type: "json" },
  { name: "FIRST_SETTINGS", type: "json" },
  { name: "KEPT_KEY", type: "secret_text" },
];

/** The metadata of an upload of release 0.3.0 onto that Worker: every binding it has kept by name, but the one the release states whole, and the update it is, stated by the upload itself. */
const METADATA = {
  main_module: "worker.js",
  compatibility_date: "2026-11-01",
  compatibility_flags: [],
  bindings: [
    ...["SITES", "DB", "JOBS", "WORKER_NAME", "ACCOUNT_ID", "ZONE", "ACCESS", "FIRST_SETTINGS", "KEPT_KEY"].map((name) => ({ name, type: "inherit" })),
    { type: "ratelimit", namespace_id: "1001", simple: { limit: 1_000_000, period: 60 }, name: "MINUTE_LIMITS" },
    { name: "LAST_UPDATE", type: "json", json: { from: "0.2.0", to: "0.3.0", schema: OWN_SCHEMA, at: NOW } },
    { name: "RELEASE", type: "plain_text", text: "0.3.0" },
  ],
  observability: OBSERVABILITY,
  annotations: { "workers/tag": "0.3.0", "workers/message": "poplin 0.3.0, by its own update" },
};

/** Every way the Worker's runtime prints a line. */
const PRINTS = ["log", "info", "warn", "error", "debug"] as const;

/** One upload as the stand-in for the API read it: the metadata, and each file by its field, with its type and its bytes as text. */
interface Uploaded {
  readonly metadata: unknown;
  readonly files: Readonly<Record<string, readonly [type: string, text: string]>>;
}

/** What one update meets. Every member has the value of an install that takes release 0.3.0 while it runs 0.2.0. */
interface Meets {
  /** The text of the website's `releases.json`, or a status it answers with in its place. */
  pins: string | number;

  /** Each asset of the release's page by its address: its bytes, or a status. */
  assets: Map<string, Uint8Array<ArrayBuffer> | number>;

  /** The Worker's bindings, its cron list, and its observability, as the API answers them. */
  script: { bindings: readonly { readonly name: string; readonly type: string }[]; crons: string[]; observability: unknown };

  /** What the API answers one call with, in place of its own answer: a response, or `"down"` for no answer at all. */
  api: Partial<Record<string, (() => Response) | "down">>;

  /** The secret the Worker holds. */
  secret: unknown;

  /** The version the install runs. */
  running: string;

  /** The variable the upload of the running code stated; left out on a Worker no update of its own put in place. */
  last?: unknown;

  /** The install's stored setting of its logs; left out on an install that keeps them. */
  logsKept?: boolean;
}

/** What one update left behind. */
interface Outcome {
  readonly ready: unknown;
  readonly put: unknown;
  readonly fetched: readonly string[];
  readonly calls: readonly string[];
  readonly uploads: readonly Uploaded[];
  readonly left: string;
}

/** A release as its page and the website hold it: the manifest's text, and what the website publishes of it. */
async function release(version: string, schema: number, config: object = CONFIG, files = { [MODULE_FILE]: MODULE, [MAP_FILE]: MAP }): Promise<{ readonly manifest: string; readonly pin: object }> {
  const manifest = await bundleManifest({ version, schema, config, files });

  return { manifest, pin: { bundle: await releaseDigest(ENCODER.encode(manifest)), schema } };
}

/** An install that takes release 0.3.0 while it runs 0.2.0, with every file where it belongs. */
async function meeting(version = "0.3.0", schema = OWN_SCHEMA): Promise<Meets> {
  const { manifest, pin } = await release(version, schema);

  return {
    pins: JSON.stringify({ [version]: pin }),
    assets: new Map<string, Uint8Array<ArrayBuffer> | number>([
      [bundleAddress(version, MANIFEST_FILE), ENCODER.encode(manifest)],
      [bundleAddress(version, MODULE_FILE), MODULE],
      [bundleAddress(version, MAP_FILE), MAP],
    ]),
    script: { bindings: BINDINGS, crons: ["*/15 * * * *"], observability: null },
    api: {},
    secret: KEY,
    running: "0.2.0",
  };
}

/** The stand-in for the website and the release's page. */
function websiteOf(meets: Meets, fetched: string[]): (url: string) => Promise<Response> {
  return async (url) => {
    fetched.push(url);
    const held = url === PINS ? meets.pins : (meets.assets.get(url) ?? 404);

    return typeof held === "number" ? new Response("no such file", { status: held }) : new Response(held);
  };
}

/** Read one upload: the metadata's JSON, and each file's type and text. The type is read from the part as it was sent: a form that is read back names a file's type by its name's ending. */
async function uploadOf(request: Request): Promise<Uploaded> {
  const sent = await request.clone().text();
  const form = await request.formData();
  const files: Record<string, readonly [string, string]> = {};
  for (const [name, value] of form.entries()) {
    const type = new RegExp(`name="${name}"; filename="${name}"\r\nContent-Type: ([^\r]+)\r\n`).exec(sent)?.[1] ?? "";
    const part: unknown = value;
    if (part instanceof Blob) files[name] = [type, await part.text()];
  }

  return { metadata: JSON.parse(String(form.get("metadata"))), files };
}

/** What the API answers one call of an account where nothing is wrong: the Worker's schedule and its settings, a schedule that is set, and an upload that is taken. */
async function answered(meets: Meets, call: string, request: Request, uploads: Uploaded[]): Promise<Response> {
  if (call === READ_CRONS) return reply({ schedules: meets.script.crons.map((cron) => ({ cron })) });

  if (call === READ_BINDINGS) return reply({ bindings: meets.script.bindings, observability: meets.script.observability });

  if (call === SET_CRONS) {
    meets.script.crons = ((await request.json()) as { cron: string }[]).map((schedule) => schedule.cron);

    return reply({ schedules: meets.script.crons.map((cron) => ({ cron })) });
  }

  if (call !== UPLOAD) return refusal(404, 7003, `no route for ${KEY}`);

  uploads.push(await uploadOf(request));

  return reply({ id: WORKER.script });
}

/** The stand-in for Cloudflare's API: it answers the Worker's settings and its schedule, takes an upload, and repeats the key in every refusal, as a careless upstream could. */
function apiOf(meets: Meets, calls: string[], uploads: Uploaded[]): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    // The SDK asks its `fetch` once what a form is sent as.
    if (url.protocol === "data:") return new Response("");

    const call = `${request.method} ${url.pathname}${url.search}`;
    calls.push(call);
    if (request.headers.get("authorization") !== `Bearer ${KEY}`) return refusal(401, 10_000, `no token ${KEY}`);

    const instead = meets.api[call];
    if (instead === "down") throw new Error(`the connection of ${KEY} was cut`);

    return instead === undefined ? answered(meets, call, request, uploads) : instead();
  };
}

/** Take one update, and say what it answered, what it fetched, what it asked the API, what it uploaded, and every text it left behind. */
async function taken(meets: Meets, wanted: { readonly version: string; readonly automatic: boolean; readonly back?: string } = { version: "latest", automatic: false }): Promise<Outcome> {
  const prints = PRINTS.map((name) => spyOn(console, name).mockImplementation(() => undefined));
  const [fetched, calls, uploads]: [string[], string[], Uploaded[]] = [[], [], []];
  const key = readKeptKey(meets.secret, { baseUrl: API, fetch: apiOf(meets, calls, uploads) });
  const self = createSelfUpdate({ key, worker: WORKER, version: meets.running, last: meets.last, now: () => NOW, fetch: websiteOf(meets, fetched), logsKept: async () => meets.logsKept !== false });

  try {
    const ready = await self.ready(wanted);
    const put = ready.ok ? await ready.put() : undefined;
    const printed = prints.flatMap((print) => print.mock.calls.map((line) => Bun.inspect(line)));

    return { ready: ready.ok ? { ok: true, version: ready.version } : ready, put, fetched, calls, uploads, left: [JSON.stringify([ready, put]), Bun.inspect([ready, put]), ...printed].join("\n") };
  } finally {
    for (const print of prints) print.mockRestore();
  }
}

/** A refusal of the API whose message repeats the key. */
const refuses = (status: number, code: number) => (): Response => refusal(status, code, `no entry for ${KEY}`);

/** The same bytes with the last one changed. */
function changed(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const other = bytes.slice();
  other[other.length - 1] = (other.at(-1) ?? 0) ^ 1;

  return other;
}

describe("an update the install takes by itself", () => {
  // Drift: this is the whole of what replaces the running code. An upload that left a binding unnamed would drop the bucket, the database, a variable, or the key; one without observability would switch the Worker's log off.
  test("the newest release is fetched, checked, and uploaded exactly once: every binding the Worker has is kept by name, and the module, its map, and observability go along", async () => {
    const meets = await meeting();
    const outcome = await taken(meets);

    expect<unknown>({ ready: outcome.ready, put: outcome.put }).toEqual({ ready: { ok: true, version: "0.3.0" }, put: { ok: true } });
    expect(outcome.fetched).toEqual([PINS, bundleAddress("0.3.0", MANIFEST_FILE), bundleAddress("0.3.0", MODULE_FILE), bundleAddress("0.3.0", MAP_FILE)]);
    expect(outcome.calls).toEqual([READ_CRONS, READ_BINDINGS, UPLOAD]);
    expect<unknown>(outcome.uploads).toEqual([
      {
        metadata: METADATA,
        files: { [MODULE_FILE]: ["application/javascript+module", new TextDecoder().decode(MODULE)], [MAP_FILE]: ["application/source-map", new TextDecoder().decode(MAP)] },
      },
    ]);
    expect(outcome.left).not.toContain(KEY);
  });

  /** One update that must end with nothing uploaded: what it meets, and the refusal it comes to. `calls` is every call to the API, and `assets` how many files of the release's page were asked for. */
  interface Row {
    readonly name: string;
    readonly meets?: (meets: Meets) => void | Promise<void>;
    readonly wanted?: { readonly version: string; readonly automatic: boolean; readonly back?: string };
    readonly ready: unknown;
    readonly put?: unknown;
    readonly calls: readonly string[];
    readonly assets: number;
  }

  const address = (file: string): string => bundleAddress("0.3.0", file);
  const release_refused = (about: string): unknown => ({ ok: false, code: "release_refused", about });
  const TAKEN = { ok: true, version: "0.3.0" };

  const rows: readonly Row[] = [
    { name: "the website does not answer", meets: (meets) => { meets.pins = 503; }, ready: release_refused("unreachable"), calls: [], assets: 0 },
    { name: "the website answers a page that is no list of releases", meets: (meets) => { meets.pins = "<!doctype html>"; }, ready: release_refused("unreachable"), calls: [], assets: 0 },
    { name: "the newest release is the running one", meets: (meets) => { meets.running = "0.3.0"; }, ready: { ok: false, code: "no_update" }, calls: [], assets: 0 },
    { name: "the newest release is older than the running one", meets: (meets) => { meets.running = "0.4.0"; }, ready: { ok: false, code: "no_update" }, calls: [], assets: 0 },
    { name: "no entry for the version asked for", wanted: { version: "0.9.9", automatic: false }, ready: release_refused("no_digest"), calls: [], assets: 0 },
    {
      name: "a release that changes the database, by itself",
      meets: async (meets) => void Object.assign(meets, await meeting("0.3.0", OWN_SCHEMA + 1)),
      wanted: { version: "0.3.0", automatic: true },
      ready: release_refused("database"),
      calls: [],
      assets: 0,
    },
    { name: "an install that holds no key", meets: (meets) => { meets.secret = undefined; }, ready: { ok: false, code: "no_key" }, calls: [], assets: 0 },
    { name: "a key Cloudflare no longer takes", meets: (meets) => { meets.api[READ_CRONS] = refuses(401, 10_000); }, ready: { ok: false, code: "key_refused" }, calls: [READ_CRONS], assets: 0 },
    {
      name: "a key without the right",
      meets: (meets) => {
        meets.api[READ_CRONS] = refuses(403, 10_000);
      },
      ready: { ok: false, code: "lacks_right", about: "Workers Scripts Write" },
      calls: [READ_CRONS],
      assets: 0,
    },
    { name: "an API that does not answer", meets: (meets) => { meets.api[READ_CRONS] = "down"; }, ready: { ok: false, code: "update_unreachable", about: "host" }, calls: [READ_CRONS, READ_CRONS, READ_CRONS], assets: 0 },
    { name: "a release with no manifest on its page", meets: (meets) => void meets.assets.delete(address(MANIFEST_FILE)), ready: release_refused("unreachable"), calls: [READ_CRONS], assets: 1 },
    {
      name: "a manifest whose digest is not the published one",
      meets: (meets) => void meets.assets.set(address(MANIFEST_FILE), changed(meets.assets.get(address(MANIFEST_FILE)) as Uint8Array<ArrayBuffer>)),
      ready: release_refused("digest_differs"),
      calls: [READ_CRONS],
      assets: 1,
    },
    {
      name: "a manifest of another version, published under this one",
      meets: async (meets) => {
        const other = await release("0.3.1", OWN_SCHEMA);
        meets.pins = JSON.stringify({ "0.3.0": other.pin });
        meets.assets.set(address(MANIFEST_FILE), ENCODER.encode(other.manifest));
      },
      ready: release_refused("other_version"),
      calls: [READ_CRONS],
      assets: 1,
    },
    {
      name: "a manifest of another schema than the website publishes",
      meets: async (meets) => {
        const other = await release("0.3.0", OWN_SCHEMA + 1);
        meets.pins = JSON.stringify({ "0.3.0": { ...other.pin, schema: OWN_SCHEMA } });
        meets.assets.set(address(MANIFEST_FILE), ENCODER.encode(other.manifest));
      },
      ready: release_refused("other_version"),
      calls: [READ_CRONS],
      assets: 1,
    },
    { name: "a module with one byte changed", meets: (meets) => void meets.assets.set(address(MODULE_FILE), changed(MODULE)), ready: release_refused("digest_differs"), calls: [READ_CRONS], assets: 2 },
    {
      name: "a module with bytes after the ones the manifest states",
      meets: (meets) => void meets.assets.set(address(MODULE_FILE), ENCODER.encode(`${new TextDecoder().decode(MODULE)}export const more = 1;`)),
      ready: release_refused("digest_differs"),
      calls: [READ_CRONS],
      assets: 2,
    },
    { name: "a module that is not on the page", meets: (meets) => void meets.assets.set(address(MODULE_FILE), 404), ready: release_refused("unreachable"), calls: [READ_CRONS], assets: 2 },
    { name: "a map with one byte changed", meets: (meets) => void meets.assets.set(address(MAP_FILE), changed(MAP)), ready: release_refused("digest_differs"), calls: [READ_CRONS], assets: 3 },
    {
      name: "a release that names a binding the Worker does not have",
      meets: (meets) => {
        meets.script.bindings = BINDINGS.filter((binding) => binding.name !== "DB");
      },
      ready: TAKEN,
      put: release_refused("needs_hand"),
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "a release that states the key's own binding by value",
      meets: async (meets) => {
        const keyed = await release("0.3.0", OWN_SCHEMA, { ...CONFIG, ratelimits: [...CONFIG.ratelimits, { name: "KEPT_KEY", namespace_id: "1002", simple: { limit: 1, period: 60 } }] });
        meets.pins = JSON.stringify({ "0.3.0": keyed.pin });
        meets.assets.set(address(MANIFEST_FILE), ENCODER.encode(keyed.manifest));
      },
      ready: TAKEN,
      put: release_refused("needs_hand"),
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "a release that states the variable an upload states itself",
      meets: async (meets) => {
        const stating = await release("0.3.0", OWN_SCHEMA, { ...CONFIG, ratelimits: [...CONFIG.ratelimits, { name: "LAST_UPDATE", namespace_id: "1002", simple: { limit: 1, period: 60 } }] });
        meets.pins = JSON.stringify({ "0.3.0": stating.pin });
        meets.assets.set(address(MANIFEST_FILE), ENCODER.encode(stating.manifest));
      },
      ready: TAKEN,
      put: release_refused("needs_hand"),
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "a version below the running one whose schema is another: its code cannot read this database",
      meets: async (meets) => {
        Object.assign(meets, await meeting("0.2.0", OWN_SCHEMA + 1));
        meets.running = "0.3.0";
      },
      wanted: { version: "0.2.0", automatic: false, back: "0.2.0" },
      ready: release_refused("database"),
      calls: [],
      assets: 0,
    },
    {
      name: "bindings read in part, with none listed: an upload after it would drop each one, so nothing is sent and the update can be asked for again",
      meets: (meets) => {
        meets.script.bindings = [];
      },
      ready: TAKEN,
      put: release_refused("host"),
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "bindings read in part, with every one a release names and not the Worker's own name",
      meets: (meets) => {
        meets.script.bindings = BINDINGS.filter((binding) => binding.name !== "WORKER_NAME");
      },
      ready: TAKEN,
      put: release_refused("host"),
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "bindings the API does not answer with: nothing was sent, so nothing can be in",
      meets: (meets) => {
        meets.api[READ_BINDINGS] = "down";
      },
      ready: TAKEN,
      put: release_refused("host"),
      calls: [READ_CRONS, READ_BINDINGS, READ_BINDINGS, READ_BINDINGS],
      assets: 3,
    },
    {
      name: "a key that was ended while the files were fetched",
      meets: (meets) => {
        meets.api[READ_BINDINGS] = refuses(401, 10_000);
      },
      ready: TAKEN,
      put: { ok: false, code: "key_refused" },
      calls: [READ_CRONS, READ_BINDINGS],
      assets: 3,
    },
  ];

  // Drift: each row is a release that must not reach the Worker. A check dropped here uploads bytes nobody published, goes below the running version, or changes the database with nobody asking.
  test.each(rows)("$name: nothing is uploaded", async ({ meets: change, wanted, ready, put, calls, assets }) => {
    const meets = await meeting();
    await change?.(meets);
    const outcome = await taken(meets, wanted);

    expect<unknown>({ ready: outcome.ready, put: outcome.put, uploads: outcome.uploads, calls: outcome.calls, assets: outcome.fetched.length - 1 }).toEqual({ ready, put, uploads: [], calls, assets });
    expect(outcome.left).not.toContain(KEY);
  });

  /** One upload Cloudflare did not take: what it answered, and what the update says. */
  const refusedUploads: readonly { readonly name: string; readonly answer: (() => Response) | "down"; readonly put: unknown; readonly tries: number }[] = [
    { name: "code that throws as it loads", answer: refuses(400, 10_021), put: { ok: false, code: "version_refused", about: "code" }, tries: 1 },
    { name: "a binding Cloudflare cannot keep", answer: refuses(400, 10_057), put: { ok: false, code: "version_refused", about: "400" }, tries: 1 },
    { name: "a key that lost the right meanwhile", answer: refuses(403, 10_000), put: { ok: false, code: "lacks_right", about: "Workers Scripts Write" }, tries: 1 },
    { name: "no answer at all", answer: "down", put: { ok: false, code: "update_unreachable", about: "host" }, tries: 1 },
    { name: "a busy answer, which is not sent a second time", answer: refuses(429, 971), put: { ok: false, code: "update_unreachable", about: "host" }, tries: 1 },
  ];

  // Drift: an upload is whole or not at all, and Cloudflare goes on running the old code after one it refused. Each answer has its own sentence, and none is told as an update that went in.
  test.each(refusedUploads)("an upload answered with $name comes to $put, and the schedule is left alone", async ({ answer, put, tries }) => {
    const meets = await meeting();
    meets.api[UPLOAD] = answer;
    meets.script.crons = ["0 * * * *"];
    const outcome = await taken(meets);

    expect<unknown>({ ready: outcome.ready, put: outcome.put, calls: outcome.calls, crons: meets.script.crons }).toEqual({
      ready: { ok: true, version: "0.3.0" },
      put,
      calls: [READ_CRONS, READ_BINDINGS, ...Array.from({ length: tries }, () => UPLOAD)],
      crons: ["0 * * * *"],
    });
    expect(outcome.left).not.toContain(KEY);
  });

  // Drift: the cron list is no part of an upload. A release that changes it must set it, and one that does not must not write it on every update.
  test.each([
    { name: "another cron list than the Worker's is set, after the upload", crons: ["0 * * * *"], refused: false, put: { ok: true }, calls: [READ_CRONS, READ_BINDINGS, UPLOAD, SET_CRONS], left: ["*/15 * * * *"] },
    { name: "a cron list of the same length with another entry is set", crons: ["*/15 * * * *", "0 * * * *"], doubled: true, refused: false, put: { ok: true }, calls: [READ_CRONS, READ_BINDINGS, UPLOAD, SET_CRONS], left: ["*/15 * * * *"] },
    { name: "a cron list Cloudflare does not take leaves the update in, and says the schedule is not", crons: [], refused: true, put: { ok: true, unset: "schedule" }, calls: [READ_CRONS, READ_BINDINGS, UPLOAD, SET_CRONS], left: [] },
  ])("$name", async ({ crons, doubled, refused, put, calls, left }) => {
    const meets = await meeting();
    if (doubled === true) {
      const twice = await release("0.3.0", OWN_SCHEMA, { ...CONFIG, triggers: { crons: ["*/15 * * * *", "*/15 * * * *"] } });
      meets.pins = JSON.stringify({ "0.3.0": twice.pin });
      meets.assets.set(bundleAddress("0.3.0", MANIFEST_FILE), ENCODER.encode(twice.manifest));
    }
    meets.script.crons = [...crons];
    if (refused) meets.api[SET_CRONS] = refuses(400, 10_100);
    const outcome = await taken(meets);

    expect<unknown>({ put: outcome.put, calls: outcome.calls, crons: meets.script.crons, uploads: outcome.uploads.length }).toEqual({ put, calls, crons: left, uploads: 1 });
    expect(outcome.left).not.toContain(KEY);
  });

  // Drift: going back is an update to the version before, and the code it puts in place must know where it came from. A variable inherited from the update before would name 0.3.0 as the running version still.
  test("going back to the version before is the same upload, and states the update anew: from the version that ran, to the lower one", async () => {
    const meets = await meeting("0.2.0");
    const last = { from: "0.2.0", to: "0.3.0", schema: OWN_SCHEMA, at: NOW - 86_400_000 };
    Object.assign(meets, { running: "0.3.0", last, script: { ...meets.script, bindings: [...BINDINGS, { name: "LAST_UPDATE", type: "json" }] } });
    const outcome = await taken(meets, { version: "0.2.0", automatic: false, back: "0.2.0" });
    const stated = outcome.uploads.map((upload) => (upload.metadata as typeof METADATA).bindings.filter((binding) => binding.name === "LAST_UPDATE"));

    expect<unknown>({ ready: outcome.ready, put: outcome.put, calls: outcome.calls, stated }).toEqual({
      ready: { ok: true, version: "0.2.0" },
      put: { ok: true },
      calls: [READ_CRONS, READ_BINDINGS, UPLOAD],
      stated: [[{ name: "LAST_UPDATE", type: "json", json: { from: "0.3.0", to: "0.2.0", schema: OWN_SCHEMA, at: NOW } }]],
    });
  });

  // Drift: an upload drops every binding it does not name. One read before the files were fetched would drop a variable a repair wrote meanwhile, such as the login's.
  test("a binding the Worker gained while the files were fetched is kept: the bindings are read after the last file", async () => {
    const meets = await meeting();
    const map = meets.assets.get(bundleAddress("0.3.0", MAP_FILE));
    meets.assets.delete(bundleAddress("0.3.0", MAP_FILE));
    const outcome = await taken({
      ...meets,
      assets: {
        get: (url: string) => {
          if (url === bundleAddress("0.3.0", MAP_FILE)) meets.script.bindings = [...BINDINGS, { name: "ADDED", type: "plain_text" }];

          return url === bundleAddress("0.3.0", MAP_FILE) ? map : meets.assets.get(url);
        },
      } as Meets["assets"],
    });
    const sent = outcome.uploads.map((upload) => (upload.metadata as typeof METADATA).bindings.map((binding) => binding.name));

    expect<unknown>([outcome.put, sent.map((names) => names.includes("ADDED"))]).toEqual([{ ok: true }, [true]]);
  });

  // Drift: Cloudflare keeps no observability across an upload. A release that states none must not switch off the log a Worker has.
  test("a release that states no observability sends the Worker's own", async () => {
    const { observability: _none, ...plain } = CONFIG;
    const { manifest, pin } = await release("0.3.0", OWN_SCHEMA, plain);
    const meets = await meeting();
    meets.pins = JSON.stringify({ "0.3.0": pin });
    meets.assets.set(bundleAddress("0.3.0", MANIFEST_FILE), ENCODER.encode(manifest));
    meets.script.observability = { enabled: true, head_sampling_rate: 0.5 };
    const outcome = await taken(meets);

    expect<unknown>(outcome.uploads.map((upload) => upload.metadata)).toEqual([{ ...METADATA, observability: { enabled: true, head_sampling_rate: 0.5, logs: { enabled: true, invocation_logs: false } } }]);
  });

  // Drift: every upload states the observability, so one that stated the release's alone would switch the logs back on at each update of an install whose setting keeps none.
  test.each([
    { name: "a release that states its observability", states: true, own: null, sent: { enabled: false, head_sampling_rate: 1, logs: { enabled: false, invocation_logs: false } } },
    {
      name: "a release that states none, on a Worker whose logs somebody switched on",
      states: false,
      own: { enabled: true, head_sampling_rate: 0.5, logs: { enabled: true, invocation_logs: true } },
      sent: { enabled: false, head_sampling_rate: 0.5, logs: { enabled: false, invocation_logs: false } },
    },
  ])("on an install whose setting keeps no logs, $name is uploaded with the logs off and no record of a request", async ({ states, own, sent }) => {
    const { observability: _none, ...plain } = CONFIG;
    const { manifest, pin } = await release("0.3.0", OWN_SCHEMA, states ? CONFIG : plain);
    const meets = await meeting();
    meets.pins = JSON.stringify({ "0.3.0": pin });
    meets.assets.set(bundleAddress("0.3.0", MANIFEST_FILE), ENCODER.encode(manifest));
    meets.script.observability = own;
    meets.logsKept = false;
    const outcome = await taken(meets);

    expect<unknown>(outcome.uploads.map((upload) => upload.metadata)).toEqual([{ ...METADATA, observability: sent }]);
  });

  // Drift: a person may take a release that changes the database, which the install never takes by itself.
  test("a release that changes the database is taken when a person asks for the newest", async () => {
    const outcome = await taken(await meeting("0.3.0", OWN_SCHEMA + 1));

    expect<unknown>({ ready: outcome.ready, put: outcome.put, uploads: outcome.uploads.length }).toEqual({ ready: { ok: true, version: "0.3.0" }, put: { ok: true }, uploads: 1 });
  });
});
