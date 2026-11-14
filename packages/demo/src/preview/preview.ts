// The demo's wiring: two installs in memory and every piece of the app mounted on one origin. It names no runtime: the host hands in the SQL driver and the sample sites.
//
//   /...                     the dashboard of the seeded install, as its sample admin; `/login` stands in for the provider's login
//   /served/<host label>/... a site as serving answers it at that hostname; `?as=visitor` asks as a stranger
//   /api/...                 the API of the seeded install
//   /setup/<state>/...       the setup page over a domain plug held in that state
//   /empty/...               the dashboard of an install that holds nothing
//   /gallery                 every page and every state of it, as a link; only when the host asks for it, and linked from nowhere
//   /state/<name>            a page reached only by a form, shown at an address of its own
//   /theme/<scheme>, /reset  the preview's own switches
//
// Every piece is the product's own handler, asked at the hostname it expects; `mount.ts` maps the addresses both ways.

import { createApi } from "../../../app/src/api/api";
import { createDashboard } from "../../../app/src/dashboard/dashboard";
import { createSetup } from "../../../app/src/dashboard/domain/setup";
import { logIn } from "../../../app/src/login/login";
import { serveSite } from "../../../app/src/sites/serve";
import { importSessionKey } from "../../../core/src/auth/cookie";
import { parseLogins } from "../../../core/src/auth/logins";
import type { SqlDriver } from "../../../core/src/database/driver";
import type { ObjectStore } from "../../../core/src/storage/storage";
import { PLUG_STATES, type PlugState, previewPlug } from "./domain-plug";
import { type Entry, galleryOf, STAGES } from "./gallery";
import { rebased, unbased } from "./base";
import { ADMIN_ORIGIN, askMount, forceTheme, type Mount, previewValue, SERVED_PREFIX, siteOrigin } from "./mount";
import { galleryPage, loginPage, plainPage, previewBar, shell } from "./own-pages";
import { type Samples, seedWorld } from "./seed";
import { ADDRESSES, openWorld, type World } from "./world";

/** What one request to the preview's API may carry. */
const API_LIMITS = { fileBytes: 100_000_000, files: 10_000, manifestBytes: 2_000_000, copies: 15 } as const;

/** Where the dashboard of the install that holds nothing is mounted. */
const EMPTY_PREFIX = "/empty";

/** The setup state whose page is shut, beside the states of the plug. */
const SHUT = "shut";

/** The visitor whose every counted try is refused, so the pages of a full minute can be seen. */
const FLOODED = "flooded";

/** The cookie that holds the forced scheme. */
const THEME_COOKIE = "preview-theme";

/** The schemes the bar can force. */
const THEMES = ["light", "dark"] as const;

/** The first part of every path the preview answers itself: none of them is a path of the dashboard. */
const OWN_PATHS = ["/gallery", "/state", "/theme", "/reset", "/setup", "/served"];

/** The request header in which a stage names its own address to the form it sends. */
const SHOWN_AT = "Preview-Shown-At";

/** The headers of the preview's own answers. */
const OWN_HEADERS = { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" } as const;

/** The pages of the dashboard that lead on to a place the product has no link for: a computer's login is begun on the computer, and the setup page is open only before the first login. */
const HINTS: Readonly<Record<string, readonly (readonly [words: string, path: string])[]>> = {
  "/tokens": [["A computer is asking to log in", "/state/allow/waiting"]],
  "/domain": [["The first-run setup page", "/setup/fresh"]],
};

/** What the host that runs the demo brings. */
export interface Host {
  /** Opens an empty SQL database of the host's own, such as SQLite in memory; asked once per install, and again at every reset. */
  readonly openDriver: () => SqlDriver;

  /** The files of every sample site the seed publishes. */
  readonly samples: Samples;

  /** Whether `/gallery` answers. */
  readonly gallery: boolean;

  /** Opens the object store of one install; a memory store when left out. A host that keeps the demo across its own restarts hands in a store it can save. */
  readonly openStore?: () => ObjectStore;

  /** The bytes that sign one install's forms; random when left out. */
  readonly formSecret?: () => Uint8Array<ArrayBuffer>;

  /** Whether the first drivers and stores the host opens already hold a demo: nothing is seeded into them, and the preview knows no admin token. */
  readonly resumed?: boolean;

  /** The path the demo sits under at its origin, such as `/poplin/demo`; the root when left out. */
  readonly base?: string;
}

/** The whole preview: the handler of every request, the admin token of the seeded install, and the gallery's links. */
export interface Preview {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly token: () => string;
  readonly entries: () => Promise<readonly Entry[]>;
}

/** The two installs and the pieces built over them. A reset makes all of it anew. */
interface Scene {
  /** The install that holds the sample data. */
  readonly seeded: World;

  /** The admin token of that install, for the API. */
  readonly token: string;

  /** The dashboard of the seeded install, which answers every path no other piece does. */
  readonly dashboard: Mount;

  /** Every piece under a prefix of its own. */
  readonly mounts: readonly Mount[];
}

/** What counts the tries of the preview's pages: every visitor is one, but the one called `flooded`, who is always refused. */
function countsOf(world: World): Pick<Parameters<typeof createDashboard>[0], "counters" | "visitorOf"> {
  return {
    counters: { takeMinute: async (window, now) => (window.key.endsWith(`:${FLOODED}`) ? { ok: false, retryAfterSeconds: 60 } : world.counters.takeMinute(window, now)) },
    visitorOf: async (request) => previewValue(request.headers, "preview-visitor") ?? "local",
  };
}

/** The session of every request: the sample admin, unless the address asked as a visitor. */
function sessionOf(world: World): Parameters<typeof createDashboard>[0]["readSession"] {
  return async (headers) => (previewValue(headers, "as") === "visitor" ? { ok: false } : { ok: true, value: world.admin.holder });
}

/** The stand-in for the provider's login: a page that says so, then the product's own login decision for the choice made on it. */
async function answerLogin(request: Request, world: World): Promise<Response> {
  const url = new URL(request.url);
  const choice = previewValue(request.headers, "preview-login");
  if (choice === undefined) return new Response(loginPage(`${url.pathname}${url.search}`), { headers: OWN_HEADERS });

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

function dashboardMount(world: World, prefix: string): Mount {
  const dashboard = createDashboard({ install: world.install, readSession: sessionOf(world), loginPath: "/login", csrfSecret: world.csrfSecret, domain: previewPlug("partial"), ...countsOf(world) });
  const answer: Mount["answer"] = (request) => (new URL(request.url).pathname === "/login" ? answerLogin(request, world) : dashboard.fetch(request));

  return { prefix, origin: ADMIN_ORIGIN, base: "", holds: "pages", answer };
}

function apiMount(world: World): Mount {
  const { database } = world.install;
  const api = createApi({ ...world.install, readToken: (id) => database.getToken(id), limits: API_LIMITS, report: (error) => console.error("preview: an API request failed", error), ...countsOf(world) });

  return { prefix: "/api", origin: ADMIN_ORIGIN, base: "/api", holds: "json", answer: api.fetch };
}

function setupMount(world: World, state: PlugState | typeof SHUT): Mount {
  const setup = createSetup({
    install: world.install,
    domain: previewPlug(state === SHUT ? "done" : state),
    open: async () => state !== SHUT,
    csrfSecret: world.csrfSecret,
    ...countsOf(world),
  });

  return { prefix: `/setup/${state}`, origin: ADMIN_ORIGIN, base: "/setup", holds: "pages", answer: setup.fetch };
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

/** Open the two installs, the seeded one first: a host that keeps the demo hands its drivers and stores out in that order every time. */
async function openScene(host: Host, resumed: boolean): Promise<Scene> {
  const kept = (): Parameters<typeof openWorld>[1] => ({ store: host.openStore?.(), csrfSecret: host.formSecret?.() });
  const seeded = await openWorld(host.openDriver(), kept());
  const empty = await openWorld(host.openDriver(), kept());
  const { token } = resumed ? { token: "" } : await seedWorld(seeded, host.samples);
  const setups = ([...PLUG_STATES, SHUT] as const).map((state) => setupMount(seeded, state));

  return { seeded, token, dashboard: dashboardMount(seeded, ""), mounts: [dashboardMount(empty, EMPTY_PREFIX), apiMount(seeded), ...setups] };
}

function themeOf(request: Request): (typeof THEMES)[number] | undefined {
  const cookie = request.headers.get("Cookie") ?? "";

  return THEMES.find((theme) => cookie.split(";").some((pair) => pair.trim() === `${THEME_COOKIE}=${theme}`));
}

/** A page of the preview's own in the scheme the request forces, or as it is. */
function themed(page: string, theme: ReturnType<typeof themeOf>): string {
  return theme === undefined ? page : forceTheme(page, theme);
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

/** A path of this origin a redirect may lead to; anything else leads home. */
function localPath(asked: string | null): string {
  return asked?.startsWith("/") === true && !asked.startsWith("//") ? asked : "/";
}

/** The address a page can be opened at again, where a change of scheme comes back to. A form's answer has none of its own: it is the stage that sent the form, or the page the form was on, one step up. */
function shownAt(request: Request, url: URL): string {
  if (request.method === "GET" || request.method === "HEAD") return `${url.pathname}${url.search}`;

  return request.headers.get(SHOWN_AT) ?? url.pathname.slice(0, url.pathname.lastIndexOf("/"));
}

/** A redirect of the preview's own, to a path from its root: a base, where there is one, is put on it on the way out. */
function goTo(path: string, status: 302 | 303 | 308): Response {
  return new Response(null, { status, headers: { Location: path } });
}

/** The preview's own redirects: a site's address without its slash, the setup page named by a query, and the scheme switch. */
function redirectOf(url: URL): Response | undefined {
  // A site's pages link relatively, so its address ends in a slash.
  if (isUnder(url.pathname, SERVED_PREFIX) && url.pathname !== SERVED_PREFIX) return goTo(`${url.pathname}/${url.search}`, 308);

  if (url.pathname === "/setup") return goTo(`/setup/${encodeURIComponent(url.searchParams.get("state") ?? "fresh")}`, 302);

  if (!isUnder(url.pathname, "/theme")) return undefined;

  const [, , chosen = ""] = url.pathname.split("/");

  const chosenAt = goTo(localPath(url.searchParams.get("to")), 303);
  chosenAt.headers.set("Set-Cookie", `${THEME_COOKIE}=${encodeURIComponent(chosen)}; Path=/; SameSite=Lax`);

  return chosenAt;
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
    const theme = themeOf(request);
    const bar = previewBar({ theme, here: shownAt(request, url), hints: HINTS[url.pathname] ?? [] });
    const own = (page: string, status = 200): Response => new Response(themed(page, theme), { status, headers: OWN_HEADERS });
    const mount = mountOf(scene, url.pathname);
    const framed = (text: string, status: number): string => themed(plainPage(text, status, bar), theme);
    if (mount !== undefined) return askMount(request, mount, { theme, origin: url.origin, bar, framed });

    if (url.pathname === "/gallery" && host.gallery) return own(galleryPage({ entries: await entries(), token: scene.token, origin: url.origin, bar }));

    const redirect = redirectOf(url);
    if (redirect !== undefined) return redirect;

    if (url.pathname === "/reset" && request.method === "POST") {
      scene = await openScene(host, false);

      return goTo("/", 303);
    }

    const stage = stageAt(url.pathname);
    if (stage === undefined) return own(shell("Not found", "<h1>Not found</h1><p>The preview has no such page.</p>", bar), 404);

    // A stage asks the preview itself, as the browser that opened it: with its cookie, and with the stage's address as the place its answer is shown at.
    const carried = { Cookie: request.headers.get("Cookie") ?? "", [SHOWN_AT]: url.pathname };

    return stage({ world: scene.seeded, origin: url.origin, ask: (path, init) => answer(new Request(`${url.origin}${path}`, { ...init, headers: { ...carried, ...init?.headers } })) });
  }

  return {
    token: () => scene.token,
    entries,
    fetch: async (request) => {
      try {
        if (base === "") return await answer(request);

        const inner = await unbased(request, base);
        if (inner === undefined) return new Response("Not found\n", { status: 404 });

        return await rebased(await answer(inner), base, new URL(request.url).origin);
      } catch (error) {
        console.error("preview: a request failed", error);

        return new Response("The preview failed on this request. The terminal says why.\n", { status: 500 });
      }
    },
  };
}
