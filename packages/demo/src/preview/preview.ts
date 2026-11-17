// The demo's wiring: two installs in memory and every piece of the app mounted at a local address. It names no runtime: the host hands in the SQL driver and the sample sites.
//
//   /...                     the dashboard of the seeded install, as its sample admin; `?as=` asks as somebody the provider's login would not let in
//   /served/<host label>/... a site as serving answers it at that hostname; `?as=visitor` asks as a stranger
//   /api/...                 the API of the seeded install
//   /empty/...               the dashboard of an install that holds nothing
//   /gallery                 every screen and every state of it that an address can show, as a link; only when the host asks for it, and linked from nowhere
//   /state/<name>            a screen that only a program's call reaches: the address makes the call itself and leads there
//   /reset                   starts the sample data over; the dashboard's "Demo" line posts to it
//
// An install without a domain answers at three origins: the same paths at the first, but `/served`, and each site as a path of one of the other two, as the product lays it out.
//
// Every piece is the product's own handler, asked at the hostname it expects; `mount.ts` maps the addresses both ways, and `kind.ts` says where each is.

import { createApi } from "../../../app/src/api/api";
import { createConsole } from "../../../app/src/console/console";
import type { ClientFiles } from "../../../app/src/console/shell";
import { serveSite } from "../../../app/src/sites/serve";
import { type Asking, checkForUpdate } from "../../../core/src/actions/update/check-update";
import type { EndLogins } from "../../../core/src/actions/access/sign-out";
import type { SelfUpdate } from "../../../core/src/actions/start-update";
import { parseLoginSecret } from "../../../core/src/auth/computer-logins";
import type { SqlDriver } from "../../../core/src/database/driver";
import { OWN_SCHEMA } from "../../../core/src/database/open";
import type { ObjectStore } from "../../../core/src/storage/storage";
import { changingPlug } from "./world/domain-plug";
import { addressNow } from "./addresses/address-now";
import { type Entry, galleryOf, STAGES } from "./pages/gallery";
import { rebased, unbased } from "./addresses/base";
import { type Kind, kindOf, type LocalOrigins } from "./world/kind";
import { askMount, type Mount, previewValue, SERVED_PREFIX } from "./addresses/mount";
import { galleryPage, missingPage, plainPage, signedOutPage, terminalPage } from "./pages/own-pages";
import { type RealSites, realAddresses } from "./world/real-sites";
import { keepLoginsWaiting, SEEDED_DAYS, type Samples, seedWorld } from "./world/seed";
import { openWorld, type World } from "./world/world";

/** What one request to the preview's API may carry. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000 } as const;

/** The free plan of the preview's invented host: the numbers are samples, and no real plan is behind them. */
const FREE_LIMITS = {
  totalBytes: { most: 10_000_000_000, warning: "The provider bills storage past its free 10 GB." },
  siteBytes: { most: 10_000_000_000, warning: "The provider bills storage past its free 10 GB." },
  filesPerPublish: { most: 5000, warning: "A publish over 5,000 files may not start on a free plan." },
  filesPerDay: { most: 32_258, warning: "Past 1,000,000 writes a month, the provider bills the rest." },
  storageWritesPerDay: { most: 30_281, warning: "Past 1,000,000 writes a month, the provider bills the rest." },
  storageReadsPerMonth: { most: 10_000_000, warning: "Requests read the storage. Past 10,000,000 reads a month, the provider bills the rest." },
  requestsPerDay: { most: 100_000, warning: "Past 100,000 requests a day you need a paid plan." },
  users: { most: 50, warning: "Past 50 users, the provider bills each login." },
} as const;

/** The figures the invented host answers as its own: made up, the same at every reading, with the account's requests a little over the install's own count of the day, and a processing time above its limit so the sign of one shows. */
const SAMPLE_FIGURES = {
  requests: 226_318,
  errors: 4,
  stopped: 0,
  slowestMs: 12.4,
  rowsRead: 13_902,
  rowsWritten: 342,
  databaseBytes: 2_300_000,
  storedBytes: 5_000_000,
  files: 212,
  unfinishedUploads: 3,
  storageWrites: 41_200,
  storageReads: 310_000,
  jobsStarted: 6,
  jobsDone: 5,
  jobsFailed: 0,
  jobsRunning: 1,
} as const;

/** The invented host's side of the Usage screen as an install that keeps no key has it: sample limits, pages nothing answers at, a made-up size of the database, and no figures of the host's own. */
const OWN_USAGE_HOST = {
  name: "the provider",
  limits: {
    requestsPerDay: 100_000,
    rowsReadPerDay: 5_000_000,
    rowsWrittenPerDay: 100_000,
    storedBytes: 10_000_000_000,
    storageWritesPerMonth: 1_000_000,
    storageReadsPerMonth: 10_000_000,
    databaseBytes: 500_000_000,
    accountDatabaseBytes: 5_000_000_000,
    processingMs: 10,
    jobsAtOnce: 100,
  },
  links: {
    requests: "https://provider.example/usage/requests",
    database: "https://provider.example/usage/database",
    storage: "https://provider.example/usage/storage",
    jobs: "https://provider.example/usage/jobs",
  },
  databaseBytes: () => 1_400_000,
} as const;

/** The same side as an install that keeps a key has it: with sample figures in place of ones read anywhere, said to run ten minutes behind. */
const USAGE_HOST = { ...OWN_USAGE_HOST, behindMs: 600_000, official: async (now: number) => ({ ok: true, value: { at: now, ...SAMPLE_FIGURES } }) as const } as const;

/** When the sample release the seeded install knows of came out, where its notes are (the page of the project's releases), and its schema, which is the install's own. No such release exists. */
const SAMPLE_RELEASE = { released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases", schema: OWN_SCHEMA } as const;

/** The stand-in for the provider's way to end every login: no login is kept here, so it answers every press as done. */
const END_LOGINS: EndLogins = async () => ({ ok: true });

/** The stand-in for the host's update on an install that keeps no key: nothing is started. */
const NO_KEY_UPDATE: SelfUpdate = { holdsKey: () => false, ready: async () => ({ ok: false, code: "no_key" }) };

/** The stand-in for the provider's side of a setting the install carries there by itself, with the key it keeps: every change is taken. Nothing is sent anywhere. */
const CARRIES = { holdsKey: () => true, push: async () => ({ ok: true as const, rules: "written" as const }) };

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** Where the dashboard of the install that holds nothing is mounted. */
const EMPTY_PREFIX = "/empty";

/** The visitor whose every counted try is refused, so the pages of a full minute can be seen. */
const FLOODED = "flooded";

/** The first part of every path the preview answers itself: none of them is a path of the dashboard. */
const OWN_PATHS = ["/gallery", "/state", "/reset", "/served"];

/** Where the dashboard's "Demo" line posts to start the data over. */
const RESET_PATH = "/reset";

/** Every address a reset is posted to: the mount of the empty install writes its own prefix before the path its dashboard names. */
const RESET_PATHS = [RESET_PATH, `${EMPTY_PREFIX}${RESET_PATH}`];

/** Where the dashboard's Sign out leads: the preview's own page of a browser whose login was ended. */
const SIGNED_OUT_PATH = "/state/signed-out";

/** Every address that page is asked at: the mount of the empty install writes its own prefix before the path its dashboard names. */
const SIGNED_OUT_PATHS = [SIGNED_OUT_PATH, `${EMPTY_PREFIX}${SIGNED_OUT_PATH}`];

/** Who the address asked as, when not as the sample admin, and why the stand-in for the provider's login then admits nobody. */
const REFUSED_AS = { visitor: "no-proof", removed: "not-a-user", unchecked: "unchecked" } as const;

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

  /** The three origins of a demo whose installs have no domain: every request to it comes at one of them, and a path or real addresses are not for it. Left out, the installs sit under a domain and the demo is one origin. */
  readonly noDomain?: LocalOrigins;
}

/** The whole preview: the handler of every request, the admin token of the seeded install, the gallery's links, and the secrets its sample computers hold now. */
export interface Preview {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly token: () => string;
  readonly entries: () => Promise<readonly Entry[]>;
  readonly secrets: () => readonly string[];
}

/** The version an install of the preview says it runs. An update the dashboard starts changes it. */
interface Running {
  version: string;
}

/** The two installs and the pieces built over them. A reset makes all of it anew. */
interface Scene {
  /** The kind of install both are. */
  readonly kind: Kind;

  /** The install that holds the sample data. */
  readonly seeded: World;

  /** The admin token of that install, for the API. */
  readonly token: string;

  /** The secrets the sample computers of that install hold now. */
  readonly secrets: () => readonly string[];

  /** Begins the sample logins of that install when none waits, each call after the one before it. */
  readonly keepLogins: () => Promise<void>;

  /** The dashboard of the seeded install, which answers every path no other piece does. */
  readonly dashboard: Mount;

  /** Every piece under a prefix of its own. */
  readonly mounts: readonly Mount[];
}

/**
 * The stand-in for the host's update: it holds a key, and answers a start as the release the install knows of put in place. Nothing is fetched, and no code is replaced:
 * the install says from then on that it runs the release's version, so the page loaded again shows the update as done.
 */
function sampleUpdate(world: World, running: Running): SelfUpdate {
  return {
    holdsKey: () => true,
    ready: async () => {
      const news = (await world.install.database.readUpdateCheck())?.news ?? null;
      if (news === null || news.version === running.version) return { ok: false, code: "no_update" };

      const put = async (): Promise<{ readonly ok: true }> => {
        running.version = news.version;

        return { ok: true };
      };

      return { ok: true, version: news.version, put };
    },
  };
}

/**
 * The version an install of the preview says it runs: the one its last update named, or the host's own where it took none.
 *
 * It is read from the install's log, so a demo that is opened again from what it kept still runs the version it was updated to. A reset empties the log.
 */
async function runningOf(world: World, version: string): Promise<Running> {
  const { entries } = await world.install.database.searchAudit({ limit: 1, actions: ["update_started"] });
  const to = entries[0]?.detail.to;

  return { version: typeof to === "string" ? to : version };
}

/** Hand each request to the piece built for the version the install runs then: a piece is built once for each version. */
function byVersion(running: Running, build: (version: string) => Mount["answer"]): Mount["answer"] {
  const built = new Map<string, Mount["answer"]>();

  return (request) => {
    const answer = built.get(running.version) ?? build(running.version);
    built.set(running.version, answer);

    return answer(request);
  };
}

/** What counts the tries of the preview's pages: every visitor is one, but the one called `flooded`, who is always refused. */
function countsOf(world: World): Pick<Parameters<typeof createConsole>[0], "counters" | "visitorOf"> {
  return {
    counters: { takeMinute: async (window, now) => (window.key.endsWith(`:${FLOODED}`) ? { ok: false, retryAfterSeconds: 60 } : world.counters.takeMinute(window, now)) },
    visitorOf: async (request) => previewValue(request.headers, "preview-visitor") ?? "local",
  };
}

/** Why a request is admitted by nobody: its address asked as one of `REFUSED_AS`. None for every other request, which is the sample admin's. */
function refusalOf(headers: Headers): (typeof REFUSED_AS)[keyof typeof REFUSED_AS] | undefined {
  const as = previewValue(headers, "as");

  return as !== undefined && Object.hasOwn(REFUSED_AS, as) ? REFUSED_AS[as as keyof typeof REFUSED_AS] : undefined;
}

/** The stand-in for the provider's login, which the preview has none of: every request is the sample admin's, unless its address asked as somebody who is not let in. */
function admitOf(world: World): Parameters<typeof createConsole>[0]["admit"] {
  const since = world.install.now();

  return async (headers) => {
    const refusal = refusalOf(headers);

    return refusal === undefined ? { ok: true, actor: world.admin, since } : { ok: false, refusal };
  };
}

/**
 * The dashboard of one install at a place of the preview. It answers under its own base path, so its page, its files, and its data all stay at that place.
 *
 * The base path is the browser's own, the host's path before the place: the dashboard's client reads it from the page and asks its data there.
 */
function dashboardMount(world: World, prefix: string, host: Host, running: Running): Mount {
  const base = `${host.base ?? ""}${prefix}`;
  // The stand-in for the provider's side of the domain keeps what was repaired: one is made for the mount, whatever version it says it runs.
  const domain = changingPlug(world.kind.provider);
  const keyed = prefix !== EMPTY_PREFIX;
  const dashboard = (version: string): ReturnType<typeof createConsole> =>
    createConsole({
      install: world.install,
      version,
      layout: world.kind.layout,
      admit: admitOf(world),
      // No login happens here, so Activity gains no line of one.
      entered: async () => undefined,
      base,
      client: host.client,
      freeLimits: FREE_LIMITS,
      // The install that holds nothing stands for one that keeps no key, so both kinds of the Usage screen and of a saved setting can be seen.
      usage: keyed ? USAGE_HOST : OWN_USAGE_HOST,
      update: keyed ? sampleUpdate(world, running) : NO_KEY_UPDATE,
      ...(keyed ? { rules: CARRIES, logs: CARRIES } : {}),
      demo: { reset: `${base}${RESET_PATH}` },
      signOut: `${base}${SIGNED_OUT_PATH}`,
      domain,
      endLogins: END_LOGINS,
      ...countsOf(world),
    });
  return { prefix, origin: world.kind.adminOrigin, base, holds: "pages", answer: byVersion(running, (version) => dashboard(version).fetch) };
}

function apiMount(world: World, running: Running): Mount {
  const { database } = world.install;
  const said = { layout: world.kind.layout, report: (error: unknown) => console.error("preview: an API request failed", error) };
  const api = (version: string): ReturnType<typeof createApi> =>
    createApi({ ...world.install, ...said, version, readToken: (id) => database.getToken(id), limits: API_LIMITS, update: sampleUpdate(world, running), endLogins: END_LOGINS, ...countsOf(world) });

  return { prefix: "/api", origin: world.kind.adminOrigin, base: "/api", holds: "json", answer: byVersion(running, (version) => api(version).fetch) };
}

/** The mount of the sites at one place of the preview: the origin the kind names for it, asked through serving with the settings as they are now. */
function siteMount(world: World, place: Pick<Mount, "prefix" | "origin">): Mount {
  const { database, store, now } = world.install;
  const answer: Mount["answer"] = async (request) => {
    const settings = await database.readSettings();
    if (settings === undefined) throw new Error("the preview's install lost its settings");

    return serveSite(request, { database, store, settings, addresses: world.kind.addresses, identify: async (headers) => ({ ok: refusalOf(headers) === undefined }), now });
  };

  return { ...place, base: "", holds: "site", answer };
}

/** The stand-in for the project's website: it names a release one minor version above the running one, so the notice of a newer version can be seen. Nothing is fetched. */
function sampleLatest(version: string): Asking["fetch"] {
  const [major = "0", minor = "0"] = version.split(".");

  return async () => Response.json({ ...SAMPLE_RELEASE, version: `${major}.${Number(minor) + 1}.0` });
}

/** Open the two installs, the seeded one first: a host that keeps the demo hands its drivers and stores out in that order every time. The kind of both is chosen here, and nowhere else. */
async function openScene(host: Host, resumed: boolean): Promise<Scene> {
  const kind = kindOf(host.noDomain);
  const kept = (): Parameters<typeof openWorld>[2] => ({ store: host.openStore?.() });
  const seeded = await openWorld(host.openDriver(), kind, { ...kept(), ...(resumed ? {} : { since: Date.now() - SEEDED_DAYS * DAY_MS }) });
  const empty = await openWorld(host.openDriver(), kind, kept());
  const { token } = resumed ? { token: "" } : await seedWorld(seeded, host.samples);
  // The seeded install alone learns of a newer version: the empty one shows a dashboard with no notice.
  if (!resumed) await checkForUpdate(seeded.install, { fetch: sampleLatest(host.version) });
  const running = await runningOf(seeded, host.version);
  const pages = dashboardMount(seeded, "", host, running);
  const computers = keepLoginsWaiting(seeded, resumed ? (host.secrets ?? []) : []);
  // A login runs out ten minutes after the seed: a visitor who comes later still finds one to review.
  const answer: Mount["answer"] = async (request) => {
    await computers.keep();

    return pages.answer(request);
  };
  const mounts = [dashboardMount(empty, EMPTY_PREFIX, host, await runningOf(empty, host.version)), apiMount(seeded, running)];

  return { kind, seeded, token, secrets: computers.secrets, keepLogins: computers.keep, dashboard: { ...pages, answer }, mounts };
}

/** The stage a path names; none for every other path. */
function stageAt(path: string): (typeof STAGES)[string] | undefined {
  return Object.hasOwn(STAGES, path) ? STAGES[path] : undefined;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The mount a path of the dashboard's side belongs to: one under a prefix of its own, or the dashboard. None for a path the preview answers itself. */
function mountOf(scene: Scene, path: string): Mount | undefined {
  // The page of a browser that signed out is the preview's own, also under the prefix of the empty install's mount.
  if (SIGNED_OUT_PATHS.includes(path)) return undefined;

  const fixed = scene.mounts.find((mount) => isUnder(path, mount.prefix));
  if (fixed !== undefined) return fixed;

  return OWN_PATHS.some((own) => isUnder(path, own)) ? undefined : scene.dashboard;
}

/** Ask one mounted piece, with the real addresses of the sample sites at hand. A site's own pages link relatively and name no site's address, so none is looked up for them. */
async function askPiece(request: Request, mount: Mount, scene: Scene, host: Host): Promise<Response> {
  const real = mount.holds === "site" ? undefined : await realAddresses(scene.seeded, host.real);
  const asked = new URL(request.url);

  return askMount(request, mount, { kind: scene.kind, origin: asked.origin, framed: (text, status) => plainPage({ text, status }, scene.kind.home(asked)), real });
}

/** A redirect of the preview's own, to a path from its root or to an address at another of its origins: a base, where there is one, is put on a path on the way out. */
function goTo(address: string, status: 302 | 303 | 308): Response {
  return new Response(null, { status, headers: { Location: address } });
}

/** The way from an address of before the sample data was made anew, of a site's panel or of a served site, to the site that holds the name now; none for every other request. */
async function redirectNow(request: Request, scene: Scene): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;

  const url = new URL(request.url);
  const now = await addressNow(scene.seeded, url);

  return now === undefined ? undefined : goTo(`${now}${url.search}`, 302);
}

/**
 * Answer what is a site's to answer: the way from an address of before the sample data was made anew, or the site the kind says the address is of; none for an address of the dashboard's side.
 *
 * It is asked before anything of the preview's own, so where the sites have origins of their own, no path there is the preview's.
 */
async function siteAnswer(request: Request, scene: Scene, host: Host): Promise<Response | undefined> {
  const now = await redirectNow(request, scene);
  if (now !== undefined) return now;

  const place = scene.kind.siteAt(new URL(request.url));

  return place === undefined ? undefined : askPiece(request, siteMount(scene.seeded, place), scene, host);
}

/** The preview's own redirect: a site's address without its slash. */
function redirectOf(url: URL): Response | undefined {
  // A site's pages link relatively, so its address ends in a slash.
  if (url.pathname.startsWith(`${SERVED_PREFIX}/`) && !url.pathname.endsWith("/")) return goTo(`${url.pathname}/${url.search}`, 308);

  return undefined;
}

/**
 * Play the stage at a path over a scene: its own answer, the page of a browser that signed out, the page of what the sample computers' terminals print, or `undefined` for a path of no stage.
 * Only the logins the sample computers hold the secrets of are printed.
 */
async function stagedAt(path: string, scene: Scene): Promise<Response | undefined> {
  if (SIGNED_OUT_PATHS.includes(path)) return new Response(await signedOutPage(), { headers: OWN_HEADERS });

  const stage = stageAt(path);
  if (stage === undefined) return undefined;

  // A stage may be the first thing asked of a preview, before any page of the dashboard began the sample logins.
  await scene.keepLogins();
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
    const first = await siteAnswer(request, scene, host);
    if (first !== undefined) return first;

    if (request.method === "POST" && RESET_PATHS.includes(url.pathname)) {
      scene = await openScene(host, false);

      return goTo("/", 303);
    }

    const mount = mountOf(scene, url.pathname);
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
