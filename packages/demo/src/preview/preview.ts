// The demo's wiring: two installs in memory and every piece of the app mounted on one origin. It names no runtime: the host hands in the SQL driver and the sample sites.
//
//   /...                     the dashboard of the seeded install, as its sample admin; `/login` stands in for the provider's login
//   /served/<host label>/... a site as serving answers it at that hostname; `?as=visitor` asks as a stranger
//   /api/...                 the API of the seeded install
//   /setup/<state>/...       the setup screen over a domain plug held in that state; `first` is an install with nothing set, `shut` a page that is closed
//   /empty/...               the dashboard of an install that holds nothing
//   /gallery                 every screen and every state of it that an address can show, as a link; only when the host asks for it, and linked from nowhere
//   /state/<name>            a screen that only a program's call reaches: the address makes the call itself and leads there
//   /reset                   starts the sample data over; the dashboard's "Demo" line posts to it
//
// Every piece is the product's own handler, asked at the hostname it expects; `mount.ts` maps the addresses both ways.

import { createApi } from "../../../app/src/api/api";
import { createConsole } from "../../../app/src/console/console";
import { createSetupConsole } from "../../../app/src/console/setup-console";
import type { ClientFiles } from "../../../app/src/console/shell";
import { logIn } from "../../../app/src/login/login";
import { serveSite } from "../../../app/src/sites/serve";
import { type Asking, checkForUpdate } from "../../../core/src/actions/check-update";
import type { Rebuilding } from "../../../core/src/actions/start-update";
import { parseLoginSecret } from "../../../core/src/auth/computer-logins";
import { importSessionKey } from "../../../core/src/auth/cookie";
import { parseLogins } from "../../../core/src/auth/logins";
import type { SqlDriver } from "../../../core/src/database/driver";
import { DEFAULT_PUBLIC_WORD } from "../../../core/src/names/marker";
import type { ObjectStore } from "../../../core/src/storage/storage";
import { changingPlug, PLUG_STATES, type PlugState, previewFirstRun, previewPlug } from "./domain-plug";
import { type Entry, galleryOf, STAGES } from "./gallery";
import { rebased, unbased } from "./base";
import { ADMIN_ORIGIN, askMount, type Mount, previewValue, SERVED_PREFIX, siteOrigin } from "./mount";
import { galleryPage, loginPage, missingPage, plainPage, terminalPage } from "./own-pages";
import { panelNow } from "./panel-now";
import { type RealSites, realAddresses } from "./real-sites";
import { keepLoginsWaiting, SEEDED_DAYS, type Samples, seedWorld } from "./seed";
import { ADDRESSES, openWorld, type World } from "./world";

/** What one request to the preview's API may carry. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The free plan of the preview's invented host: the numbers are samples, and no real plan is behind them. */
const FREE_LIMITS = {
  totalBytes: { most: 10_000_000_000, warning: "The host bills storage past its free 10 GB." },
  siteBytes: { most: 10_000_000_000, warning: "The host bills storage past its free 10 GB." },
  filesPerPublish: { most: 5000, warning: "A publish over 5,000 files may not start on a free plan." },
  filesPerDay: { most: 32_258, warning: "Past 1,000,000 writes a month, the host bills the rest." },
  storageWritesPerDay: { most: 30_281, warning: "Past 1,000,000 writes a month, the host bills the rest." },
  storageReadsPerMonth: { most: 10_000_000, warning: "Requests read the storage. Past 10,000,000 reads a month, the host bills the rest." },
  requestsPerDay: { most: 100_000, warning: "Past 100,000 requests a day you need a paid plan." },
  logins: { most: 50, warning: "Past 50 users, the host bills each login." },
} as const;

/** The invented host's side of the Usage screen: sample limits, and pages nothing answers at. It reads no figures of its own. */
const USAGE_HOST = {
  name: "the host",
  limits: { requestsPerDay: 100_000, rowsReadPerDay: 5_000_000, rowsWrittenPerDay: 100_000, storedBytes: 10_000_000_000, storageWritesPerMonth: 1_000_000, storageReadsPerMonth: 10_000_000 },
  links: { requests: "https://provider.example/usage/requests", database: "https://provider.example/usage/database", storage: "https://provider.example/usage/storage" },
} as const;

/** When the sample release the seeded install knows of came out, and where its notes are: the page of the project's releases. No such release exists. */
const SAMPLE_RELEASE = { released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases", database: false } as const;

/** The address the seeded install keeps as the one that starts its rebuild. Nothing is there, and nothing is ever sent to it. */
const SAMPLE_REBUILD = "https://provider.example/rebuilds/sample";

/** The stand-in for the provider's rebuild: it takes the sample address alone and answers every start as taken, without a request. */
const REBUILD: Omit<Rebuilding, "counters"> = { accepts: (address) => address.href === SAMPLE_REBUILD, fetch: async () => new Response(null, { status: 204 }) };

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** Where the dashboard of the install that holds nothing is mounted. */
const EMPTY_PREFIX = "/empty";

/** The setup state whose page is shut, beside the states of the plug. */
const SHUT = "shut";

/** The setup state of an install with nothing set, which the setup screen asks its domain and first login. */
const FIRST = "first";

/** The visitor whose every counted try is refused, so the pages of a full minute can be seen. */
const FLOODED = "flooded";

/** The first part of every path the preview answers itself: none of them is a path of the dashboard. */
const OWN_PATHS = ["/gallery", "/state", "/reset", "/setup", "/served"];

/** Where the dashboard's "Demo" line posts to start the data over. */
const RESET_PATH = "/reset";

/** Every address a reset is posted to: the mount of the empty install writes its own prefix before the path its dashboard names. */
const RESET_PATHS = [RESET_PATH, `${EMPTY_PREFIX}${RESET_PATH}`];

/** The headers of the preview's own answers. */
const OWN_HEADERS = { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" } as const;

/** What the host that runs the demo brings. */
export interface Host {
  /** Opens an empty SQL database of the host's own, such as SQLite in memory; asked once per install, and again at every reset. */
  readonly openDriver: () => SqlDriver;

  /** The files of every sample site the seed publishes. */
  readonly samples: Samples;

  /** The version of poplin the demo's installs say they run. */
  readonly version: string;

  /** The dashboard's client, as the host hands its files out. */
  readonly client: ClientFiles;

  /** Whether `/gallery` answers; it does not when left out. */
  readonly gallery?: boolean;

  /** Opens the object store of one install; a memory store when left out. A host that keeps the demo across its own restarts hands in a store it can save. */
  readonly openStore?: () => ObjectStore;

  /** Whether the first drivers and stores the host opens already hold a demo: nothing is seeded into them, and the preview knows no admin token. */
  readonly resumed?: boolean;

  /** The secrets the sample computers of that demo held, as its `secrets` handed them out: the logins it left waiting are then still theirs. None when left out. */
  readonly secrets?: readonly string[];

  /** The path the demo sits under at its origin, such as `/poplin/demo`; the root when left out. */
  readonly base?: string;

  /** Where a person finds why a request failed, as the answer to that request says it; the terminal when left out. */
  readonly reasonAt?: string;

  /** The real address of each sample site on an install that holds the same sites: the links of the seeded dashboard lead there. None when left out. */
  readonly real?: RealSites;
}

/** The whole preview: the handler of every request, the admin token of the seeded install, the gallery's links, and the secrets its sample computers hold now. */
export interface Preview {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly token: () => string;
  readonly entries: () => Promise<readonly Entry[]>;
  readonly secrets: () => readonly string[];
}

/** The two installs and the pieces built over them. A reset makes all of it anew. */
interface Scene {
  /** The install that holds the sample data. */
  readonly seeded: World;

  /** The admin token of that install, for the API. */
  readonly token: string;

  /** The secrets the sample computers of that install hold now. */
  readonly secrets: () => readonly string[];

  /** The dashboard of the seeded install, which answers every path no other piece does. */
  readonly dashboard: Mount;

  /** Every piece under a prefix of its own. */
  readonly mounts: readonly Mount[];
}

/** What counts the tries of the preview's pages: every visitor is one, but the one called `flooded`, who is always refused. */
function countsOf(world: World): Pick<Parameters<typeof createConsole>[0], "counters" | "visitorOf"> {
  return {
    counters: { takeMinute: async (window, now) => (window.key.endsWith(`:${FLOODED}`) ? { ok: false, retryAfterSeconds: 60 } : world.counters.takeMinute(window, now)) },
    visitorOf: async (request) => previewValue(request.headers, "preview-visitor") ?? "local",
  };
}

/** The session of every request: the sample admin, unless the address asked as a visitor. */
function sessionOf(world: World): Parameters<typeof createConsole>[0]["readSession"] {
  return async (headers) => (previewValue(headers, "as") === "visitor" ? { ok: false } : { ok: true, value: world.admin.holder });
}

/** The stand-in for the provider's login: a page that says so, then the product's own login decision for the choice made on it. */
async function answerLogin(request: Request, world: World): Promise<Response> {
  const url = new URL(request.url);
  const choice = previewValue(request.headers, "preview-login");
  if (choice === undefined) return new Response(await loginPage(`${url.pathname}${url.search}`), { headers: OWN_HEADERS });

  const { database, now } = world.install;
  const logins = parseLogins((await database.readSettings())?.logins ?? []);
  const key = await database.readSigningKey();
  if (!logins.ok || key === undefined) throw new Error("the preview's install lost its logins or its key");

  const outcome = await logIn(request.headers, {
    identify: async () => (choice === "admin" ? { ok: true, value: world.admin.holder } : { ok: false, refusal: "refused" }),
    logins: logins.value,
    sessionKey: await importSessionKey(key),
    now: now(),
    returnTo: url.searchParams.get("return"),
  });

  // The two answers the host gives around the decision: its refusal, and the way back.
  if (!outcome.ok) return new Response("Forbidden\n", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  await database.appendAudit({ action: "login", detail: {} }, { by: outcome.email, at: now() });

  return new Response(null, { status: 302, headers: { Location: outcome.location, "Set-Cookie": outcome.setCookie } });
}

/**
 * The dashboard of one install at a place of the preview. It answers under its own base path, so its page, its files, and its data all stay at that place.
 *
 * The base path is the browser's own, the host's path before the place: the dashboard's client reads it from the page and asks its data there.
 */
function dashboardMount(world: World, prefix: string, host: Host): Mount {
  const base = `${host.base ?? ""}${prefix}`;
  const login = `${base}/login`;
  const dashboard = createConsole({
    install: world.install,
    version: host.version,
    readSession: sessionOf(world),
    loginPath: login,
    base,
    client: host.client,
    freeLimits: FREE_LIMITS,
    usage: USAGE_HOST,
    rebuild: REBUILD,
    demo: { reset: `${base}${RESET_PATH}` },
    domain: changingPlug(),
    ...countsOf(world),
  });
  const answer: Mount["answer"] = (request) => (new URL(request.url).pathname === login ? answerLogin(request, world) : dashboard.fetch(request));

  return { prefix, origin: ADMIN_ORIGIN, base, holds: "pages", answer };
}

function apiMount(world: World, version: string): Mount {
  const { database } = world.install;
  const said = { version, publicWord: DEFAULT_PUBLIC_WORD, report: (error: unknown) => console.error("preview: an API request failed", error) };
  const api = createApi({ ...world.install, ...said, readToken: (id) => database.getToken(id), limits: API_LIMITS, rebuild: REBUILD, ...countsOf(world) });

  return { prefix: "/api", origin: ADMIN_ORIGIN, base: "/api", holds: "json", answer: api.fetch };
}

/** The setup screen over a plug held in one state, at an address of its own, under the host's path as the dashboards are. */
function setupScreenMount(world: World, state: PlugState | typeof SHUT | typeof FIRST, host: Host): Mount {
  const prefix = `/setup/${state}`;
  const at = `${host.base ?? ""}${prefix}`;
  const setup = createSetupConsole({
    install: world.install,
    domain: state === FIRST ? previewFirstRun() : previewPlug(state === SHUT ? "done" : state),
    open: async () => state !== SHUT,
    client: host.client,
    at,
    ...countsOf(world),
  });

  return { prefix, origin: ADMIN_ORIGIN, base: at, holds: "pages", answer: setup.fetch };
}

/** The mount of the site a path names by its host label: its own hostname, asked through serving with the settings as they are now. */
function siteMount(world: World, label: string): Mount {
  const { database, store, now } = world.install;
  const answer: Mount["answer"] = async (request) => {
    const settings = await database.readSettings();
    if (settings === undefined) throw new Error("the preview's install lost its settings");

    return serveSite(request, { database, store, settings, addresses: ADDRESSES, identify: sessionOf(world), now });
  };

  return { prefix: `${SERVED_PREFIX}/${label}`, origin: siteOrigin(label), base: "", holds: "site", answer };
}

/** The stand-in for the project's website: it names a release one minor version above the running one, so the notice of a newer version can be seen. Nothing is fetched. */
function sampleLatest(version: string): Asking["fetch"] {
  const [major = "0", minor = "0"] = version.split(".");

  return async () => Response.json({ ...SAMPLE_RELEASE, version: `${major}.${Number(minor) + 1}.0` });
}

/** Open the two installs, the seeded one first: a host that keeps the demo hands its drivers and stores out in that order every time. */
async function openScene(host: Host, resumed: boolean): Promise<Scene> {
  const kept = (): Parameters<typeof openWorld>[1] => ({ store: host.openStore?.() });
  const seeded = await openWorld(host.openDriver(), { ...kept(), ...(resumed ? {} : { since: Date.now() - SEEDED_DAYS * DAY_MS }) });
  const empty = await openWorld(host.openDriver(), kept());
  const { token } = resumed ? { token: "" } : await seedWorld(seeded, host.samples);
  // The seeded install alone learns of a newer version and keeps an address to update at: the empty one shows a dashboard with no notice.
  if (!resumed) await checkForUpdate(seeded.install, { fetch: sampleLatest(host.version) });
  if (!resumed) await seeded.install.database.keepUpdateAddress(SAMPLE_REBUILD, { by: seeded.admin.holder, at: seeded.install.now() });
  const pages = dashboardMount(seeded, "", host);
  const computers = keepLoginsWaiting(seeded, resumed ? (host.secrets ?? []) : []);
  // A login runs out ten minutes after the seed: a visitor who comes later still finds one to review.
  const answer: Mount["answer"] = async (request) => {
    await computers.keep();

    return pages.answer(request);
  };
  const screens = ([...PLUG_STATES, SHUT, FIRST] as const).map((state) => setupScreenMount(seeded, state, host));
  const mounts = [dashboardMount(empty, EMPTY_PREFIX, host), apiMount(seeded, host.version), ...screens];

  return { seeded, token, secrets: computers.secrets, dashboard: { ...pages, answer }, mounts };
}

/** The stage a path names; none for every other path. */
function stageAt(path: string): (typeof STAGES)[string] | undefined {
  return Object.hasOwn(STAGES, path) ? STAGES[path] : undefined;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The mount a path belongs to: one under a prefix of its own, the mount of the site whose label follows `/served/`, or the dashboard. */
function mountOf(scene: Scene, path: string): Mount | undefined {
  const fixed = scene.mounts.find((mount) => isUnder(path, mount.prefix));
  if (fixed !== undefined) return fixed;

  if (!isUnder(path, SERVED_PREFIX)) return OWN_PATHS.some((own) => isUnder(path, own)) ? undefined : scene.dashboard;

  const [, label = ""] = path.slice(SERVED_PREFIX.length).split("/");
  if (label === "" || path === `${SERVED_PREFIX}/${label}`) return undefined;

  return siteMount(scene.seeded, decodeURIComponent(label));
}

/** Ask one mounted piece, with the real addresses of the sample sites at hand. A site's own pages link relatively and name no site's address, so none is looked up for them. */
async function askPiece(request: Request, mount: Mount, scene: Scene, host: Host): Promise<Response> {
  const real = mount.holds === "site" ? undefined : await realAddresses(scene.seeded, host.real);

  return askMount(request, mount, { origin: new URL(request.url).origin, framed: plainPage, real });
}

/** A redirect of the preview's own, to a path from its root: a base, where there is one, is put on it on the way out. */
function goTo(path: string, status: 302 | 303 | 308): Response {
  return new Response(null, { status, headers: { Location: path } });
}

/** The way from a panel's address of before the sample data was made anew to the site that holds the name now, on the seeded dashboard; none for every other request. */
async function panelRedirect(request: Request, mount: Mount | undefined, scene: Scene): Promise<Response | undefined> {
  if (request.method !== "GET" || mount !== scene.dashboard) return undefined;

  const url = new URL(request.url);
  const panel = await panelNow(scene.seeded, url.pathname);

  return panel === undefined ? undefined : goTo(`${panel}${url.search}`, 302);
}

/** The preview's own redirects: a site's address without its slash, and the setup page named by a query. */
function redirectOf(url: URL): Response | undefined {
  // A site's pages link relatively, so its address ends in a slash.
  if (isUnder(url.pathname, SERVED_PREFIX) && url.pathname !== SERVED_PREFIX) return goTo(`${url.pathname}/${url.search}`, 308);

  if (url.pathname === "/setup") return goTo(`/setup/${encodeURIComponent(url.searchParams.get("state") ?? "fresh")}`, 302);

  return undefined;
}

/** Play the stage at a path over a scene: its own answer, the page of what the sample computers' terminals print, or `undefined` for a path of no stage. Only the logins the sample computers hold the secrets of are printed. */
async function stagedAt(path: string, scene: Scene): Promise<Response | undefined> {
  const stage = stageAt(path);
  if (stage === undefined) return undefined;

  const staged = await stage({ world: scene.seeded, samples: scene.secrets().flatMap((secret) => parseLoginSecret(secret) ?? []) });

  return staged instanceof Response ? staged : new Response(await terminalPage(staged), { headers: OWN_HEADERS });
}

/**
 * Build the preview: seed its installs and wire every piece.
 *
 * @returns the handler of every request to the demo's origin. Nothing it holds outlives the host's drivers, and it calls nothing outside it
 * @throws {Error} the seed was refused
 */
export async function createPreview(host: Host): Promise<Preview> {
  let scene = await openScene(host, host.resumed === true);
  const base = host.base ?? "";
  const entries = (): Promise<readonly Entry[]> => galleryOf(scene.seeded);

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const own = (page: string, status = 200): Response => new Response(page, { status, headers: OWN_HEADERS });
    if (request.method === "POST" && RESET_PATHS.includes(url.pathname)) {
      scene = await openScene(host, false);

      return goTo("/", 303);
    }

    const mount = mountOf(scene, url.pathname);
    const panel = await panelRedirect(request, mount, scene);
    if (panel !== undefined) return panel;

    if (mount !== undefined) return askPiece(request, mount, scene, host);

    if (url.pathname === "/gallery" && host.gallery === true) return own(await galleryPage({ entries: await entries(), token: scene.token, origin: url.origin }));

    const redirect = redirectOf(url);
    if (redirect !== undefined) return redirect;

    const staged = await stagedAt(url.pathname, scene);
    if (staged === undefined) return own(await missingPage(), 404);

    return staged;
  }

  return {
    token: () => scene.token,
    entries,
    secrets: () => scene.secrets(),
    fetch: async (request) => {
      try {
        if (base === "") return await answer(request);

        const inner = await unbased(request, base);
        if (inner === undefined) return new Response("Not found\n", { status: 404 });

        return await rebased(await answer(inner), base, new URL(request.url).origin);
      } catch (error) {
        console.error("preview: a request failed", error);

        return new Response(`The preview failed on this request. ${host.reasonAt ?? "The terminal says why."}\n`, { status: 500 });
      }
    },
  };
}
