// The index's links: every screen of the product and every state of it that an address can show, each as a link.
//
// A screen that only a program's call reaches is a stage: an address under `/state/` that makes the call itself and leads to the screen.

import { beginLogin } from "../../../core/src/actions/computer-logins";
import { listSites } from "../../../core/src/actions/list";
import { AUDIT_WINDOW } from "../../../core/src/database/database";
import { PLUG_STATES, type PlugState } from "./domain-plug";
import { ADMIN_ORIGIN, localAddress } from "./mount";
import type { World } from "./world";

/** The groups of the index, in the order shown. */
export const GROUPS = ["Dashboard", "Dashboard of an install that holds nothing", "One site in the dashboard", "Access: allow this computer", "Setup page", "The login", "Served sites", "API"] as const;

/** The dashboard's mount, as an address of the install is read from one of its pages. */
const HOME = { prefix: "", origin: ADMIN_ORIGIN, base: "" };

/** Where a site that is not there would be: its panel in the dashboard, and the path of a public name no site holds. */
const NO_PLACE: Place = { page: "/sites/nothing--000000000000", served: "/served/nobody-page/", open: "/served/nobody-page/" };

/** A code no login waits under. */
const NO_CODE = "WDJB-MJHT";

/** What the install holds in each state of the plug before Repair is pressed, in the index's words. */
const SETUP_WORDS: Readonly<Record<PlugState, string>> = {
  fresh: "nothing exists yet",
  partial: "some pieces missing or changed",
  "access-off": "a step only a person can do",
  done: "every piece stands",
  "token-refused": "the account token is refused",
  unreachable: "the provider does not answer",
};

/** How many logins a stage adds to the log: more than a narrowed page of the log looks at before it stops. */
const MANY_LOGINS = AUDIT_WINDOW + 200;

/** The screens of the dashboard, each by the path that shows it. */
const SCREENS = [
  ["Sites", "/"],
  ["Access", "/tokens"],
  ["Activity", "/activity"],
  ["Usage", "/usage"],
  ["Settings", "/settings"],
  ["Domain", "/domain"],
] as const;

/** Where one site is in the preview: its panel in the dashboard, the path of its label address, and the path a visitor opens, which is its public name's when it has one. */
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

/** What a stage works with: the seeded install. */
interface Stage {
  readonly world: World;
}

/** Begin a login as a computer would, and lead to the screen that allows it. */
async function waitingLogin(stage: Stage): Promise<Response> {
  const begun = await beginLogin(stage.world.install, { scope: "publisher", computer: "studio-laptop" }, "preview");
  if (!begun.ok) return new Response(`The preview's login was refused: ${begun.code}.\n`, { status: 500 });

  return new Response(null, { status: 303, headers: { Location: `/tokens/allow?${new URLSearchParams({ code: begun.code })}` } });
}

/** Add more logins to the log than a narrowed page looks at, and lead to the page of what happened to sites: it stops before it finds an entry, and says so. A reset takes the logins away. */
async function longLog({ world }: Stage): Promise<Response> {
  const signed = { by: world.admin.holder, at: world.install.now() };
  for (let added = 0; added < MANY_LOGINS; added += 1) await world.install.database.appendAudit({ action: "login", detail: {} }, signed);

  return new Response(null, { status: 303, headers: { Location: "/activity?kind=sites" } });
}

/** Every stage, by its address. */
export const STAGES: Readonly<Record<string, (stage: Stage) => Promise<Response>>> = {
  "/state/allow/waiting": waitingLogin,
  "/state/activity/long": longLog,
};

/** Where each seeded site is now, by its name: its panel in the dashboard, and the preview paths it is served at. A site that was deleted since is absent. */
async function placesOf(world: World): Promise<ReadonlyMap<string, Place>> {
  const lists = await Promise.all([false, true].map((trash) => listSites(world.install, world.admin, { trash })));
  const sites = lists.flatMap((listed) => (listed.ok ? listed.sites : []));
  const local = (address: string): string => localAddress(address, HOME);

  return new Map(sites.map((site) => [site.name, { page: `/sites/${site.label}`, served: local(site.addresses.site), open: local(site.addresses.public ?? site.addresses.site) }]));
}

function dashboardEntries(): Entry[] {
  return [
    ...SCREENS.map(([name, path]) => ({ group: "Dashboard" as const, name, path })),
    ...SCREENS.map(([name, path]) => ({ group: "Dashboard of an install that holds nothing" as const, name, path: `/empty${path}` })),
    { group: "Dashboard", name: "Sites: the public ones, by name", path: "/?access=public&sort=name&dir=asc" },
    { group: "Dashboard", name: "Activity: what happened to sites", path: "/activity?kind=sites" },
    { group: "Dashboard", name: "Activity: a long log, searched in parts", path: "/state/activity/long" },
    { group: "Dashboard", name: "No such screen", path: "/nothing" },
    { group: "Access: allow this computer", name: "Waiting for a decision", path: "/state/allow/waiting" },
    { group: "Access: allow this computer", name: "Code not found, decided, or run out", path: `/tokens/allow?code=${NO_CODE}` },
    { group: "The login", name: "No session: the way to the login", path: "/settings?as=visitor" },
    { group: "The login", name: "Login refused", path: "/login?preview-login=refused", status: 403 },
  ];
}

function setupEntries(): Entry[] {
  const group = "Setup page" as const;

  return [
    ...PLUG_STATES.map((state) => ({ group, name: `Before Repair: ${SETUP_WORDS[state]}`, path: `/setup/${state}` })),
    { group, name: "An install with nothing set: its domain and first login", path: "/setup/first" },
    { group, name: "Shut: the install is set up", path: "/setup/shut", status: 404 },
  ];
}

/** The pages of the seeded sites: each site's panel in the dashboard, then what serving answers an admin and a stranger. */
function siteEntries(places: ReadonlyMap<string, Place>): Entry[] {
  const page = (name: string): string => places.get(name)?.page ?? NO_PLACE.page;
  const served = (name: string): string => places.get(name)?.served ?? NO_PLACE.served;
  const open = (name: string): string => places.get(name)?.open ?? NO_PLACE.served;
  const group = "One site in the dashboard" as const;
  const visitors = "Served sites" as const;

  return [
    { group, name: "Private, three versions kept", path: page("sales-report") },
    { group, name: "Public, under a public name", path: page("lisbon-trip") },
    { group, name: "Unlisted, no frames, renamed since it was made", path: page("pricing") },
    { group, name: "Expires in two days", path: page("checkout") },
    { group, name: "Expired", path: page("winter-offer") },
    { group, name: "No such site", path: NO_PLACE.page },
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
    { group: visitors, name: "An expired site, as the admin", path: served("winter-offer"), status: 404 },
    { group: visitors, name: "An expired site, as a stranger", path: `${served("winter-offer")}?as=visitor`, status: 404 },
    { group: visitors, name: "A public name no site holds, as a stranger", path: `${NO_PLACE.served}?as=visitor`, status: 404 },
  ];
}

/**
 * List every link of the index for the install as it is now.
 *
 * @returns the entries in the order the index shows them; one that names a seeded site follows the site's label through a new link
 */
export async function galleryOf(world: World): Promise<readonly Entry[]> {
  const api: Entry = { group: "API", name: "A request without a token", path: "/api/whoami", status: 401 };

  return [...dashboardEntries(), ...siteEntries(await placesOf(world)), ...setupEntries(), api];
}
