// The index's links: every page of the product and every state of it, each at an address of its own.
//
// A state that an address can carry (a notice, a refusal, a view) is a plain link. A page that only a form reaches is a stage: an address under `/state/` that sends the form itself and shows the answer.

import { Parser } from "htmlparser2";

import { beginLogin } from "../../../core/src/actions/computer-logins";
import { listSites } from "../../../core/src/actions/list";
import { PLUG_STATES, type PlugState } from "./domain-plug";
import { ADMIN_ORIGIN, localAddress } from "./mount";
import type { World } from "./world";

/** The groups of the index, in the order shown. */
export const GROUPS = [
  "Dashboard",
  "Dashboard of an install that holds nothing",
  "One site in the dashboard",
  "Tokens: allow this computer",
  "Settings",
  "Domain tab",
  "Setup page",
  "Refusals and the login",
  "Served sites",
  "API",
] as const;

/** A label no site has. */
const NO_SITE = "nothing--000000000000";

/** The dashboard's mount, as an address of the install is read from one of its pages. */
const HOME = { prefix: "", origin: ADMIN_ORIGIN, base: "" };

/** Where a site that is not there would be: its page in the dashboard, and the path of a public name no site holds. */
const NO_PLACE: Place = { page: `/sites/${NO_SITE}`, served: "/served/nobody-page/", open: "/served/nobody-page/" };

/** A code no login waits under. */
const NO_CODE = "WDJB-MJHT";

/** The token a stage pastes into the domain form: the preview's plug takes any. */
const SAMPLE_TOKEN = "sample-token";

/** The name of the hidden field of a form that holds its token. */
const CSRF_FIELD = "csrf";

/** The status a check answers with in each state of the plug that reads no table. */
const SETUP_STATUS: Partial<Record<PlugState, number>> = { "token-refused": 403, unreachable: 502 };

/** What each state of the plug shows, in the index's words. */
const SETUP_WORDS: Readonly<Record<PlugState, string>> = {
  fresh: "nothing exists yet",
  partial: "some objects missing or changed",
  "access-off": "a step only a person can do",
  done: "every object stands",
  "token-refused": "the token is refused",
  unreachable: "the provider does not answer",
};

/** The sentences the dashboard says after a change to a site, by the code its address carries. */
const SITE_NOTICES: readonly (readonly [name: string, query: string])[] = [
  ["Saved", "done=saved"],
  ["An older version made live", "done=rolled_back"],
  ["New link made", "done=new_link"],
  ["Restored from the trash", "done=restored"],
  ["Refused: public name taken", "refused=name_taken"],
  ["Refused: public name breaks the rules", "refused=bad_name"],
  ["Refused: public name reserved", "refused=reserved_name"],
  ["Refused: a value it does not take", "refused=bad_argument&about=expires"],
  ["Refused: version not kept", "refused=no_such_version"],
  ["Refused: form incomplete", "refused=missing_field"],
];

/** Where one site is in the preview: its dashboard page, the path of its label address, and the path a visitor opens, which is its public name's when it has one. */
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

/** What a stage works with: the seeded install, the preview's origin, and a way to ask the preview itself. */
interface Stage {
  readonly world: World;
  readonly origin: string;
  readonly ask: (path: string, init?: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }) => Promise<Response>;
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/** The token the first form of a page carries in its hidden field; empty for a page with no such field. */
function formToken(page: string): string {
  let token: string | undefined;
  const parser = new Parser({
    onopentag: (name, attributes) => {
      if (name === "input" && attributes.name === CSRF_FIELD) token ??= attributes.value;
    },
  });
  parser.end(page);

  return token ?? "";
}

/** Send a form as a page of the preview would: the token of `page`, then the fields, to `action`. Each is sent as a visitor of its own, so a stage never fills the minute of the one before. */
async function submit(stage: Stage, page: string, action: string, fields: Readonly<Record<string, string>>): Promise<Response> {
  const csrf = formToken(await (await stage.ask(page)).text());
  const visitor = action.includes("?") ? "" : `?preview-visitor=${crypto.randomUUID()}`;

  return stage.ask(`${action}${visitor}`, {
    method: "POST",
    headers: { Origin: stage.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, ...fields }).toString(),
  });
}

/** Begin a login as a computer would and open the page that allows it; `query` is added to that page's address. */
async function waitingLogin(stage: Stage, query = ""): Promise<Response> {
  const begun = await beginLogin(stage.world.install, { scope: "publisher", computer: "studio-laptop" }, "preview");
  if (!begun.ok) return new Response(`The preview's login was refused: ${begun.code}.\n`, { status: 500 });

  return seeOther(`/tokens/allow?${new URLSearchParams({ code: begun.code })}${query}`);
}

function setupStages(): Record<string, (stage: Stage) => Promise<Response>> {
  const runs = PLUG_STATES.flatMap((state) => (["check", "repair"] as const).map((run) => [state, run] as const));

  return Object.fromEntries(runs.map(([state, run]) => [`/state/setup/${state}/${run}`, (stage: Stage) => submit(stage, `/setup/${state}`, `/setup/${state}/${run}`, { token: SAMPLE_TOKEN })]));
}

/** Every stage, by its address. */
export const STAGES: Readonly<Record<string, (stage: Stage) => Promise<Response>>> = {
  "/state/allow/waiting": (stage) => waitingLogin(stage),
  "/state/allow/not-ticked": (stage) => waitingLogin(stage, "&refused=not_confirmed"),
  "/state/domain/check": (stage) => submit(stage, "/domain", "/domain/check", { token: SAMPLE_TOKEN }),
  "/state/domain/repair": (stage) => submit(stage, "/domain", "/domain/repair", { token: SAMPLE_TOKEN }),
  "/state/form/not-from-here": (stage) => submit(stage, "/settings", "/settings/save", { csrf: "stale" }),
  "/state/setup/too-many-tries": (stage) => submit(stage, "/setup/fresh", "/setup/fresh/check?preview-visitor=flooded", { token: SAMPLE_TOKEN }),
  ...setupStages(),
};

/** Where each seeded site is now, by its name: its page in the dashboard, and the preview paths it is served at. A site that was deleted since is absent. */
async function placesOf(world: World): Promise<ReadonlyMap<string, Place>> {
  const lists = await Promise.all([false, true].map((trash) => listSites(world.install, world.admin, { trash })));
  const sites = lists.flatMap((listed) => (listed.ok ? listed.sites : []));
  const local = (address: string): string => localAddress(address, HOME);

  return new Map(sites.map((site) => [site.name, { page: `/sites/${site.label}`, served: local(site.addresses.site), open: local(site.addresses.public ?? site.addresses.site) }]));
}

function dashboardEntries(): Entry[] {
  const tabs = [
    ["Sites", "/"],
    ["Sites: the trash", "/?view=trash"],
    ["Tokens", "/tokens"],
    ["Settings", "/settings"],
    ["Activity", "/activity"],
    ["Usage", "/usage"],
    ["Domain", "/domain"],
  ] as const;

  return [
    ...tabs.map(([name, path]) => ({ group: "Dashboard" as const, name, path })),
    ...tabs.map(([name, path]) => ({ group: "Dashboard of an install that holds nothing" as const, name, path: `/empty${path}` })),
    { group: "Dashboard", name: "Sites: deleted forever", path: "/?view=trash&done=deleted" },
    { group: "Dashboard", name: "Sites: deleted forever, files left behind", path: "/?view=trash&done=deleted_files_left" },
    { group: "Settings", name: "A value above a free limit, with its warning", path: "/settings" },
    { group: "Settings", name: "Sign everyone out, the confirm step", path: "/settings" },
    { group: "Settings", name: "Saved", path: "/settings?done=saved" },
    { group: "Settings", name: "Refused: a value it does not take", path: "/settings?refused=bad_argument&about=default_expires" },
    { group: "Settings", name: "Refused: box not ticked", path: "/settings?refused=not_confirmed" },
    { group: "Domain tab", name: "After a check", path: "/state/domain/check" },
    { group: "Domain tab", name: "After a repair that stopped at a failure", path: "/state/domain/repair" },
    { group: "Domain tab", name: "Guards saved", path: "/domain?done=saved" },
    { group: "Refusals and the login", name: "No such page", path: "/nothing", status: 404 },
    { group: "Refusals and the login", name: "A form that did not come from the page", path: "/state/form/not-from-here", status: 403 },
    { group: "Refusals and the login", name: "No session: the way to the login", path: "/settings?as=visitor" },
    { group: "Refusals and the login", name: "Login refused", path: "/login?preview-login=refused", status: 403 },
  ];
}

function tokenEntries(): Entry[] {
  const group = "Tokens: allow this computer" as const;

  return [
    { group, name: "Waiting for a decision", path: "/state/allow/waiting" },
    { group, name: "Refused: box not ticked", path: "/state/allow/not-ticked" },
    { group, name: "Code not found, decided, or run out", path: `/tokens/allow?code=${NO_CODE}` },
    { group, name: "Too many tries", path: `/tokens/allow?code=${NO_CODE}&preview-visitor=flooded`, status: 429 },
    { group, name: "Allowed", path: "/tokens?done=allowed" },
    { group, name: "Denied", path: "/tokens?done=denied" },
    { group, name: "Token revoked", path: "/tokens?done=revoked" },
    { group, name: "Refused: no such token", path: "/tokens?refused=no_such_token" },
  ];
}

function setupEntries(): Entry[] {
  const group = "Setup page" as const;
  const runs = PLUG_STATES.flatMap((state) => [
    { group, name: `Check: ${SETUP_WORDS[state]}`, path: `/state/setup/${state}/check`, status: SETUP_STATUS[state] },
    { group, name: `Repair: ${SETUP_WORDS[state]}`, path: `/state/setup/${state}/repair`, status: SETUP_STATUS[state] },
  ]);

  return [
    { group, name: "The token form", path: "/setup/fresh" },
    ...runs,
    { group, name: "Too many tries", path: "/state/setup/too-many-tries", status: 429 },
    { group, name: "Shut: the install is set up", path: "/setup/shut", status: 404 },
  ];
}

/** The pages of the seeded sites: each site's dashboard page and its states, then what serving answers an admin and a stranger. */
function siteEntries(places: ReadonlyMap<string, Place>): Entry[] {
  const page = (name: string): string => places.get(name)?.page ?? NO_PLACE.page;
  const served = (name: string): string => places.get(name)?.served ?? NO_PLACE.served;
  const open = (name: string): string => places.get(name)?.open ?? NO_PLACE.served;
  const group = "One site in the dashboard" as const;
  const visitors = "Served sites" as const;

  return [
    { group, name: "Private, three versions kept: settings, roll back, new link, delete", path: page("sales-report") },
    { group, name: "Public, under a public name", path: page("lisbon-trip") },
    { group, name: "Unlisted, no frames, renamed since it was made", path: page("pricing") },
    { group, name: "Expires in two days", path: page("checkout") },
    { group, name: "Expired", path: page("spring-offer") },
    { group, name: "In the trash: restore, delete for good", path: page("old-notes") },
    { group, name: "Moved to the trash", path: `${page("old-notes")}?done=trashed` },
    { group, name: "Refused: typed text did not match", path: `${page("old-notes")}?refused=wrong_confirmation` },
    { group, name: "Refused: the site sits in the trash", path: `${page("old-notes")}?refused=in_trash` },
    { group, name: "No such site", path: `/sites/${NO_SITE}`, status: 404 },
    ...SITE_NOTICES.map(([name, query]) => ({ group, name, path: `${page("sales-report")}?${query}` })),
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
    { group: visitors, name: "An expired site, as the admin", path: served("spring-offer"), status: 404 },
    { group: visitors, name: "An expired site, as a stranger", path: `${served("spring-offer")}?as=visitor`, status: 404 },
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

  return [...dashboardEntries(), ...siteEntries(await placesOf(world)), ...tokenEntries(), ...setupEntries(), api];
}
