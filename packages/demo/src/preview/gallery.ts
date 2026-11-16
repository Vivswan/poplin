// The index's links: every screen of the product and every state of it that an address can show, each as a link.
//
// A screen that only a program's call reaches is a stage: an address under `/state/` that makes the call itself and leads to the screen.

import { listSites } from "../../../core/src/actions/list";
import { signedBy } from "../../../core/src/actions/reach";
import type { SiteObject } from "../../../core/src/actions/site-object";
import { REVIEW_PAGE } from "../../../core/src/api/routes";
import { showUserCode } from "../../../core/src/auth/computer-logins";
import { AUDIT_WINDOW } from "../../../core/src/database/database";
import { parsePublicName } from "../../../core/src/names/names";
import { localAddress } from "./mount";
import type { World } from "./world";

/** The groups of the index, in the order shown. */
export const GROUPS = ["Dashboard", "Dashboard of an install that holds nothing", "One site in the dashboard", "Access: allow this computer", "The login", "Served sites", "API"] as const;

/** The panel of a site that is not there, in the dashboard. */
const NO_PANEL = "/sites/nothing--000000000000";

/** A public name no sample site holds. */
const NOBODY = "nobody";

/** An id no login waits under. */
const NO_LOGIN = "0000000000000000";

/** How many logins a stage adds to the log: more than a narrowed page of the log looks at before it stops. */
const MANY_LOGINS = AUDIT_WINDOW + 200;

/** The sample site a stage lets run out, and how long before now it then ended, in milliseconds. The table gives it a month, so every list of the samples holds it. */
const [RUN_OUT, HOUR_MS] = ["winter-offer", 3_600_000] as const;

/** The screens of the dashboard, each by the path that shows it. */
const SCREENS = [
  ["Sites", "/"],
  ["Access", "/tokens"],
  ["Activity", "/activity"],
  ["Usage", "/usage"],
  ["Settings", "/settings"],
  ["Domain", "/domain"],
] as const;

/** Where one site is in the preview: its panel in the dashboard, its label address, and the address a visitor opens, which is its public name's when it has one. Each is written as a page of the dashboard links to it. */
interface Place {
  readonly page: string;
  readonly served: string;
  readonly open: string;
}

/** One link of the index. `status` is what the address answers with at the end of its redirects: 200 when left out. */
export interface Entry {
  readonly group: (typeof GROUPS)[number];
  readonly name: string;
  readonly path: string;
  readonly status?: number;
}

/** What a stage works with. */
interface Stage {
  /** The seeded install. */
  readonly world: World;

  /** The ids of the logins the sample computers began and still hold the secrets of. */
  readonly samples: readonly string[];
}

/** What the terminal of a computer that began a login shows: the address of the page that allows it, and the code, which no page of the dashboard shows whole. `computer` is the name it gave. */
export interface Printed {
  readonly computer: string;
  readonly address: string;
  readonly code: string;
}

/** Answer what the terminal of each sample computer that waits shows: the preview stands in for those terminals, since no computer is behind a sample login. A login a real terminal began is left out: its code is that terminal's alone. */
async function waitingLogins({ world, samples }: Stage): Promise<readonly Printed[]> {
  const waiting = await world.install.database.listWaitingComputerLogins(world.install.now());

  return waiting.filter((login) => samples.includes(login.id)).map((login) => ({ computer: login.computer, address: `${REVIEW_PAGE}/${login.id}`, code: showUserCode(login.code) }));
}

/** Add more logins to the log than a narrowed page looks at, and lead to the page of what happened to sites: it stops before it finds an entry, and says so. A reset takes the logins away. */
async function longLog({ world }: Stage): Promise<Response> {
  const signed = signedBy(world.admin, world.install.now());
  for (let added = 0; added < MANY_LOGINS; added += 1) await world.install.database.appendAudit({ action: "login", detail: {} }, signed);

  return new Response(null, { status: 303, headers: { Location: "/activity?kind=sites" } });
}

/** Every seeded site as the install lists it now, the trash included. */
async function seededSites(world: World): Promise<readonly SiteObject[]> {
  const lists = await Promise.all([false, true].map((trash) => listSites(world.install, world.admin, { trash })));

  return lists.flatMap((listed) => (listed.ok ? listed.sites : []));
}

/** An address of the install as a page of the dashboard links to it. */
function fromHome(world: World, address: string): string {
  return localAddress(address, { here: { prefix: "", origin: world.kind.adminOrigin, base: "" }, kind: world.kind });
}

/** Where one site is in the preview. */
function placeOf(world: World, site: SiteObject): Place {
  return { page: `/sites/${site.label}`, served: fromHome(world, site.addresses.site), open: fromHome(world, site.addresses.public ?? site.addresses.site) };
}

/** Where a site that is not there would be: its panel in the dashboard, and the address of a public name no site holds. */
function noPlace(world: World): Place {
  const name = parsePublicName(NOBODY, world.install.reservedNames);
  if (!name.ok) throw new Error(`the install keeps the public name ${NOBODY}`);

  const served = fromHome(world, world.install.publicAddressOf(name.value));

  return { page: NO_PANEL, served, open: served };
}

/** Where each seeded site is now, by its name: its panel in the dashboard, and the preview paths it is served at. A site that was deleted since is absent. */
async function placesOf(world: World): Promise<ReadonlyMap<string, Place>> {
  return new Map((await seededSites(world)).map((site) => [site.name, placeOf(world, site)]));
}

/** A stage that ends a sample site an hour ago, as no call of the product can, and leads to one page of it. A reset gives the site its month back. */
function runOut(to: (place: Place) => string): (stage: Stage) => Promise<Response> {
  return async ({ world }) => {
    const site = (await seededSites(world)).find((each) => each.name === RUN_OUT);
    const at = world.install.now();
    if (site !== undefined) await world.install.database.changeDetails(site.id, { expires: at - HOUR_MS }, signedBy(world.admin, at));

    return new Response(null, { status: 303, headers: { Location: to(site === undefined ? noPlace(world) : placeOf(world, site)) } });
  };
}

/** Every stage, by its address. */
export const STAGES: Readonly<Record<string, (stage: Stage) => Promise<Response | readonly Printed[]>>> = {
  "/state/allow/waiting": waitingLogins,
  "/state/activity/long": longLog,
  "/state/expired/panel": runOut((place) => place.page),
  "/state/expired/admin": runOut((place) => place.served),
  "/state/expired/stranger": runOut((place) => `${place.served}?as=visitor`),
};

function dashboardEntries(): Entry[] {
  return [
    ...SCREENS.map(([name, path]) => ({ group: "Dashboard" as const, name, path })),
    ...SCREENS.map(([name, path]) => ({ group: "Dashboard of an install that holds nothing" as const, name, path: `/empty${path}` })),
    { group: "Dashboard", name: "Sites: the public ones, by name", path: "/?access=public&sort=name&dir=asc" },
    { group: "Dashboard", name: "Activity: what happened to sites", path: "/activity?kind=sites" },
    { group: "Dashboard", name: "Activity: a long log, searched in parts", path: "/state/activity/long" },
    { group: "Dashboard", name: "Usage: the problems of the last 30 days", path: "/usage?days=30" },
    { group: "Dashboard", name: "Usage: the panel of a problem that is not in the list", path: "/usage?problem=2026-01-01.request_failed" },
    { group: "Dashboard", name: "No such screen", path: "/nothing" },
    { group: "Access: allow this computer", name: "The logins that wait: what each terminal prints", path: "/state/allow/waiting" },
    { group: "Access: allow this computer", name: "Login not found, decided, or run out", path: `${REVIEW_PAGE}/${NO_LOGIN}` },
    { group: "The login", name: "No login behind the request", path: "/settings?as=visitor", status: 403 },
    { group: "The login", name: "An email that is no user", path: "/settings?as=removed", status: 403 },
    { group: "The login", name: "A login that cannot be checked", path: "/settings?as=unchecked", status: 503 },
  ];
}

/** The pages of the seeded sites: each site's panel in the dashboard, then what serving answers an admin and a stranger. */
function siteEntries(places: ReadonlyMap<string, Place>, none: Place): Entry[] {
  const page = (name: string): string => places.get(name)?.page ?? none.page;
  const served = (name: string): string => places.get(name)?.served ?? none.served;
  const open = (name: string): string => places.get(name)?.open ?? none.served;
  const group = "One site in the dashboard" as const;
  const visitors = "Served sites" as const;

  return [
    { group, name: "Private, three versions kept", path: page("sales-report") },
    { group, name: "Public, under a public name", path: page("lisbon-trip") },
    { group, name: "Unlisted, no frames, renamed since it was made", path: page("pricing") },
    { group, name: "Expires in two days", path: page("checkout") },
    { group, name: "Expired", path: "/state/expired/panel" },
    { group, name: "No such site", path: none.page },
    { group: visitors, name: "Sales report, private, as the admin", path: served("sales-report") },
    { group: visitors, name: "Sales report, private, as a stranger who came around the login", path: `${served("sales-report")}?as=visitor`, status: 404 },
    { group: visitors, name: "Launch deck, unlisted, as a stranger", path: `${served("launch-deck")}?as=visitor` },
    { group: visitors, name: "Lisbon trip, public, under its public name", path: `${open("lisbon-trip")}?as=visitor` },
    { group: visitors, name: "Handbook, public", path: `${open("handbook")}?as=visitor` },
    { group: visitors, name: "Checkout prototype, private, as the admin", path: served("checkout") },
    { group: visitors, name: "Status board, private, as the admin", path: served("status-board") },
    { group: visitors, name: "Pricing, unlisted, renamed since it was made", path: served("pricing") },
    { group: visitors, name: "A file the site does not have", path: `${served("launch-deck")}nothing.html`, status: 404 },
    { group: visitors, name: "A site in the trash, as the admin", path: served("old-notes"), status: 404 },
    { group: visitors, name: "A site in the trash, as a stranger", path: `${served("old-notes")}?as=visitor`, status: 404 },
    { group: visitors, name: "An expired site, as the admin", path: "/state/expired/admin", status: 404 },
    { group: visitors, name: "An expired site, as a stranger", path: "/state/expired/stranger", status: 404 },
    { group: visitors, name: "A public name no site holds, as a stranger", path: `${none.served}?as=visitor`, status: 404 },
  ];
}

/**
 * List every link of the index for the install as it is now.
 *
 * @returns the entries in the order the index shows them; one that names a seeded site follows the site's label through a new link
 */
export async function galleryOf(world: World): Promise<readonly Entry[]> {
  const api: Entry = { group: "API", name: "A request without a token", path: "/api/whoami", status: 401 };

  return [...dashboardEntries(), ...siteEntries(await placesOf(world), noPlace(world)), api];
}
