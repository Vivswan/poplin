// The sample data of the demo, made through the product's own actions: tokens, sites published from the sample sites the host hands in, a site in the trash, settings above a free limit, logins, the day's requests, and a check of the domain.
//
// The check finds every piece in place, so the install remembers a healthy domain. A Check on the Domain tab finds pieces to repair and replaces that memory; a reset brings the healthy one back.
//
// Every name and address is invented. The history is played in the order of its moments, so the audit log rises in time with its sequence, as a real install's does.

import type { SiteChanges } from "../../../core/src/actions/changes";
import { beginLogin, decideLogin, redeemLogin } from "../../../core/src/actions/computer-logins";
import { changeConfig } from "../../../core/src/actions/config";
import { deleteSite } from "../../../core/src/actions/delete";
import { listSites } from "../../../core/src/actions/list";
import { issueToken, revokeToken } from "../../../core/src/actions/manage-tokens";
import { newLink } from "../../../core/src/actions/new-link";
import { publishSite } from "../../../core/src/actions/publish";
import { runDomain } from "../../../app/src/dashboard/domain/domain-run";
import { restoreSite } from "../../../core/src/actions/restore";
import { updateSite } from "../../../core/src/actions/set";
import { parseLogin } from "../../../core/src/auth/logins";
import type { Actor } from "../../../core/src/auth/scopes";
import { previewPlug } from "./domain-plug";
import type { World } from "./world";

/** The milliseconds of one day, and of one minute. */
const [DAY_MS, MINUTE_MS] = [86_400_000, 60_000];

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** The second person of the install, who is let in by a change of the settings. The first is the world's own admin. */
const SECOND_ADMIN = "jonas@example.com";

/** The note of the admin token the terminal prints. An admin token runs out, so it is issued last, at the present moment. */
const ADMIN_TOKEN = "local preview";

/** The computers that wait to be logged in: one asks to publish, one asks for everything, so the choice to allow it for less shows. */
const WAITING = [
  { scope: "publisher", computer: "studio-laptop" },
  { scope: "admin", computer: "build-server" },
] as const;

/** The token the seed's check of the domain is run with. The preview's plug takes any, and nothing keeps it. */
const DOMAIN_TOKEN = "sample-token";

/** How long a login waits before it runs out, in milliseconds. */
const LOGIN_LIFE_MS = 600_000;

/** The requests counted today and the opens of a page among them, by the name of the site that answered them: together nine tenths of the day's limit, so a line near its limit shows. Each earlier day of the week counts a share of them. */
const COUNTED: Readonly<Record<string, readonly [requests: number, views: number]>> = {
  "sales-report": [1_860, 410],
  lisbon: [214_259, 14_800],
  handbook: [8_415, 2_150],
  "launch-deck": [240, 64],
  pricing: [130, 38],
  "team-site": [96, 31],
};

/** The days the counts are seeded over: today and the six before it. */
const COUNTED_DAYS = 7;

/** Every sample site, by the name it is made under, the oldest first. */
const SITES: readonly Draft[] = [
  { ago: 30, name: "handbook", sample: "trip-summary", by: "mira", settings: { access: "public", title: "Team handbook" } },
  { ago: 21, name: "sales-report", sample: "sales-report", by: "report agent", settings: { title: "Q3 sales report" } },
  { ago: 15, name: "old-notes", sample: "trip-summary", by: "travel agent", settings: { title: "Notes from the offsite" } },
  { ago: 12, name: "launch-deck", sample: "launch-deck", by: "mira", settings: { access: "unlisted", title: "Launch deck" } },
  { ago: 10, name: "team-site", sample: "checkout-prototype", beside: { deck: "launch-deck", report: "sales-report" }, by: "mira", settings: { title: "Team site" } },
  { ago: 9, name: "lisbon-trip", sample: "trip-summary", by: "travel agent", settings: { access: "public", public_name: "lisbon", title: "Lisbon, four days" } },
  { ago: 5, name: "pricing-draft", sample: "sales-report", by: "report agent", settings: { access: "unlisted", embeddable: false } },
  { ago: 4, name: "spring-offer", sample: "checkout-prototype", by: "mira", settings: { access: "unlisted", title: "Spring offer", expires: "1h" } },
  { ago: 2, name: "status-board", sample: "launch-deck", by: "mira", settings: {} },
  { ago: 0, name: "checkout", sample: "checkout-prototype", by: "mira", settings: { title: "Checkout prototype", expires: "2d" } },
];

/** What happened to the install besides the making of its sites, the oldest moment first. The settings end with a second login, a limit on the sites, and a day's requests above the provider's free limit, so its warning shows. */
const HISTORY: readonly Moment[] = [
  { ago: 30.9, does: "token", by: "mira", note: "report agent" },
  { ago: 30.8, does: "token", by: "mira", note: "travel agent" },
  { ago: 29.6, does: "settings", by: "mira", changes: { logins: ["mira@example.com", SECOND_ADMIN] } },
  { ago: 29.5, does: "login", by: "jonas" },
  { ago: 28.9, does: "domain", by: "mira", run: "check" },
  { ago: 28.8, does: "domain", by: "mira", run: "repair" },
  { ago: 27.7, does: "version", by: "mira", site: "handbook" },
  { ago: 26.5, does: "token", by: "jonas", note: "old laptop" },
  { ago: 25.6, does: "version", by: "jonas", site: "handbook" },
  { ago: 24.4, does: "login", by: "mira" },
  { ago: 23.2, does: "login", by: "jonas" },
  { ago: 22.4, does: "set", by: "jonas", site: "handbook", changes: { search_engines: true } },
  { ago: 21.6, does: "login", by: "mira" },
  { ago: 20, does: "version", by: "report agent", site: "sales-report" },
  { ago: 19, does: "version", by: "report agent", site: "sales-report" },
  { ago: 18.6, does: "set", by: "jonas", site: "sales-report", changes: { embeddable: false } },
  { ago: 17.3, does: "login", by: "jonas" },
  { ago: 16.4, does: "version", by: "report agent", site: "sales-report" },
  { ago: 14.5, does: "set", by: "mira", site: "old-notes", changes: { access: "unlisted" } },
  { ago: 14.1, does: "login", by: "mira" },
  { ago: 13.8, does: "version", by: "mira", site: "handbook" },
  { ago: 13.1, does: "version", by: "travel agent", site: "old-notes" },
  { ago: 12.4, does: "login", by: "jonas" },
  { ago: 11.6, does: "link", by: "mira", site: "launch-deck" },
  { ago: 11.2, does: "computer", by: "mira", computer: "design-laptop", allow: true },
  { ago: 10.6, does: "login", by: "jonas" },
  { ago: 9.7, does: "version", by: "report agent", site: "sales-report" },
  { ago: 8.9, does: "version", by: "mira", site: "launch-deck" },
  { ago: 8.6, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 7.9, does: "revoke", by: "mira", note: "old laptop" },
  { ago: 7.4, does: "login", by: "mira" },
  { ago: 6.8, does: "version", by: "mira", site: "team-site" },
  { ago: 6.1, does: "computer", by: "jonas", computer: "kiosk-display", allow: false },
  { ago: 5.6, does: "version", by: "report agent", site: "sales-report" },
  { ago: 4.6, does: "version", by: "report agent", site: "pricing-draft" },
  { ago: 4.3, does: "login", by: "mira" },
  { ago: 3.9, does: "set", by: "mira", site: "pricing-draft", changes: { name: "pricing" } },
  { ago: 3.5, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 3.2, does: "set", by: "jonas", site: "spring-offer", changes: { embeddable: false } },
  { ago: 3, does: "trash", by: "mira", site: "old-notes" },
  { ago: 2.9, does: "login", by: "jonas" },
  { ago: 2.7, does: "version", by: "report agent", site: "sales-report" },
  { ago: 2.4, does: "trash", by: "jonas", site: "launch-deck" },
  { ago: 2.3, does: "restore", by: "mira", site: "launch-deck" },
  { ago: 1.8, does: "login", by: "jonas" },
  { ago: 1.5, does: "version", by: "mira", site: "team-site" },
  { ago: 1, does: "settings", by: "mira", changes: { max_sites: 40, requests_per_day: 250_000 } },
  { ago: 0.9, does: "login", by: "mira" },
  { ago: 0.7, does: "version", by: "report agent", site: "pricing-draft" },
  { ago: 0.6, does: "version", by: "mira", site: "handbook" },
  { ago: 0.4, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 0.3, does: "login", by: "jonas" },
  { ago: 0.2, does: "version", by: "report agent", site: "sales-report" },
];

/** One file of a sample site, read whole by the host. */
interface SampleFile {
  /** Where the file sits in its site: segments joined by `/`. */
  readonly path: string;

  /** The media type the file is served with. */
  readonly contentType: string;

  /** The file's bytes. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** The files of every sample site, by the name of its folder under `demo/samples`. */
export type Samples = Readonly<Record<string, readonly SampleFile[]>>;

/** Who does a thing: one of the two people, or an agent by the note of its token. */
type Who = "mira" | "jonas" | "report agent" | "travel agent";

/** One sample site: how many days ago it is made, the sample it is published from, the samples it holds beside that one, each under a folder, and who publishes it. */
interface Draft {
  readonly ago: number;
  readonly name: string;
  readonly sample: string;
  readonly beside?: Readonly<Record<string, string>>;
  readonly by: Who;
  readonly settings: SiteChanges;
}

/** A moment that touches a site, by the name the site was made under, whatever it is called since. */
type SiteMoment =
  | { readonly does: "version" | "trash" | "restore" | "link"; readonly site: string }
  | { readonly does: "set"; readonly site: string; readonly changes: SiteChanges };

/** A moment that touches no site. A `computer` asks to publish and is allowed or denied. */
type PlainMoment =
  | { readonly does: "token" | "revoke"; readonly note: string }
  | { readonly does: "settings"; readonly changes: Readonly<Record<string, unknown>> }
  | { readonly does: "domain"; readonly run: "check" | "repair" }
  | { readonly does: "computer"; readonly computer: string; readonly allow: boolean }
  | { readonly does: "login" };

/** One moment of the history: how many days ago it happens, what is done, and by whom. */
type Moment = { readonly ago: number; readonly by: Who } & (SiteMoment | PlainMoment);

/** A sample site as the history goes on with it: the label it has now, and the files every version of it holds. */
interface Made {
  label: string;
  readonly files: Parameters<typeof publishSite>[2]["files"];
}

/** What the history has made so far: who acts under each name, the id of each token by its note, and each site by the name it was made under. */
interface Cast {
  readonly actors: Map<string, Actor>;
  readonly tokens: Map<string, string>;
  readonly sites: Map<string, Made>;
}

/** What the seed hands back: the whole admin token for the API, shown this once. */
interface Seeded {
  readonly token: string;
}

/** The value of an action that was done; a refusal is a mistake in the seed. */
function done<Answer extends { readonly ok: boolean }>(answer: Answer, what: string): Extract<Answer, { readonly ok: true }> {
  if (!answer.ok) throw new Error(`the demo's seed was refused at ${what}: ${JSON.stringify(answer)}`);

  return answer as Extract<Answer, { readonly ok: true }>;
}

/** What the history made under a name; a name it has not made yet is a mistake in the seed. */
function made<Value>(known: ReadonlyMap<string, Value>, name: string): Value {
  const value = known.get(name);
  if (value === undefined) throw new Error(`the demo's seed names ${name} before it is made`);

  return value;
}

/** The files a draft publishes: its sample at the root, and every sample beside it under its folder. A site of many files shows what a small one cannot, such as a copy that takes more than one request. */
function filesOf(draft: Draft, samples: Samples): Made["files"] {
  const placed = [["", draft.sample] as const, ...Object.entries(draft.beside ?? {}).map(([folder, sample]) => [`${folder}/`, sample] as const)];

  return placed.flatMap(([folder, sample]) => {
    const files = samples[sample];
    if (files === undefined) throw new Error(`the demo's seed has no sample called ${sample}`);

    return files.map(({ path, contentType, bytes }) => ({ path: `${folder}${path}`, contentType, size: bytes.length, open: () => new Blob([bytes]).stream() }));
  });
}

/** The two people of the install, each as an admin behind a session. */
function people(world: World): Cast["actors"] {
  const second = parseLogin(SECOND_ADMIN);
  if (!second.ok) throw new Error(`the demo's second login was refused: ${second.refusal}`);

  return new Map<string, Actor>([
    ["mira", world.admin],
    ["jonas", { scope: "admin", holder: second.value }],
  ]);
}

/** Publish a sample site for the first time. */
async function makeSite(world: World, cast: Cast, draft: Draft, samples: Samples): Promise<void> {
  const files = filesOf(draft, samples);
  const { site } = done(await publishSite(world.install, made(cast.actors, draft.by), { files, name: draft.name, ...draft.settings }), draft.name);
  cast.sites.set(draft.name, { label: site.label, files });
}

/** Do one thing to a site that is made, and keep the label it has after it. */
async function changeSite(world: World, cast: Cast, moment: SiteMoment & { readonly by: Who }): Promise<void> {
  const { install } = world;
  const actor = made(cast.actors, moment.by);
  const site = made(cast.sites, moment.site);
  const answers = {
    version: () => publishSite(install, actor, { files: site.files, site: site.label }),
    set: () => updateSite(install, actor, { site: site.label, ...(moment.does === "set" ? moment.changes : {}) }),
    trash: () => deleteSite(install, actor, { site: site.label }),
    restore: () => restoreSite(install, actor, site.label),
    link: () => newLink(install, actor, site.label),
  };
  const after = done(await answers[moment.does](), `${moment.does} of ${moment.site}`).site;
  if (after !== null) site.label = after.label;
}

/** Let a computer ask to publish, and a person decide a minute later. An allowed computer collects its token at once, so it stands among the tokens. */
async function decideComputer(world: World, cast: Cast, moment: Extract<Moment, { readonly does: "computer" }>): Promise<void> {
  const { install, clock } = world;
  const asked = done(await beginLogin(install, { scope: "publisher", computer: moment.computer }, "preview"), `the login of ${moment.computer}`);
  clock.held = install.now() + MINUTE_MS;
  done(await decideLogin(install, made(cast.actors, moment.by), { code: asked.code, allow: moment.allow, scope: "publisher" }), `the decision on ${moment.computer}`);
  if (moment.allow) done(await redeemLogin(install, { secret: asked.secret }), `the token of ${moment.computer}`);
}

/** Do what one moment of the history says. A login and a run on the domain are written to the log as the pages that do them write them. */
async function play(world: World, cast: Cast, moment: Moment): Promise<void> {
  const { install } = world;
  const actor = made(cast.actors, moment.by);
  const signed = { by: actor.holder, at: install.now() };

  switch (moment.does) {
    case "token": {
      const { record } = done(await issueToken(install, actor, { note: moment.note, scope: "publisher" }), `the token of ${moment.note}`);
      cast.tokens.set(moment.note, record.id);
      cast.actors.set(moment.note, { scope: "publisher", holder: record.id });

      return undefined;
    }
    case "revoke":
      done(await revokeToken(install, actor, made(cast.tokens, moment.note)), `the end of the token of ${moment.note}`);

      return undefined;
    case "settings":
      done(await changeConfig(install, actor, moment.changes), "the settings");

      return undefined;
    case "login":
      return install.database.appendAudit({ action: "login", detail: {} }, signed);
    case "domain":
      return install.database.appendAudit({ action: "domain_synced", detail: { run: moment.run, from: "dashboard" } }, signed);
    case "computer":
      return decideComputer(world, cast, moment);
    default:
      return changeSite(world, cast, moment);
  }
}

async function countRequests(world: World, start: number): Promise<void> {
  const listed = done(await listSites(world.install, world.admin), "the list of sites");

  for (const site of listed.sites) {
    const [requests, views] = COUNTED[site.public_name ?? site.name] ?? [0, 0];
    if (requests === 0) continue;

    for (let ago = 0; ago < COUNTED_DAYS; ago += 1) {
      const day = new Date(start - ago * DAY_MS).toISOString().slice(0, DAY_LENGTH);
      await world.install.database.addRequests({ day, site: site.id, requests: Math.ceil(requests / (ago + 1)), views: Math.floor(views / (ago + 1)) });
    }
  }
}

/** Begin the sample logins, and answer the secret each sample computer keeps to ask for its token with. */
async function beginSampleLogins(world: World): Promise<readonly string[]> {
  const secrets: string[] = [];
  for (const login of WAITING) secrets.push(done(await beginLogin(world.install, login, "preview"), `the waiting login of ${login.computer}`).secret);

  return secrets;
}

/** Ask for the token of each sample login, as its computer would, and answer the secrets of those that still wait. An allowed one gets its token, so it shows among the tokens. */
async function collectTokens(world: World, secrets: readonly string[]): Promise<readonly string[]> {
  const waiting: string[] = [];

  for (const secret of secrets) {
    const answer = done(await redeemLogin(world.install, { secret }), "a sample login asking for its token");
    if (answer.state === "pending") waiting.push(secret);
  }

  return waiting;
}

/**
 * Keep a login waiting in a demo install, however long ago it was seeded, and let an allowed one collect its token: no computer stands behind a sample login to do it.
 *
 * @returns a step to run before a page is answered. It begins the sample logins when none waits, and looks again only once the last waiting login has run out, so logins a visitor just decided do not come back at once
 */
export function keepLoginsWaiting(world: World): () => Promise<void> {
  let lookAgain = Number.NEGATIVE_INFINITY;
  let secrets: readonly string[] | undefined;
  let last: Promise<void> = Promise.resolve();

  const step = async (): Promise<void> => {
    const now = world.install.now();
    // The logins a demo opened before left behind have lost their sample computers, so none could collect its token: they go, and new ones are begun.
    if (secrets === undefined) await world.install.database.sweepComputerLogins(now + LOGIN_LIFE_MS);

    secrets = await collectTokens(world, secrets ?? []);
    if (now < lookAgain) return;

    lookAgain = now + LOGIN_LIFE_MS;
    const waiting = await world.install.database.listWaitingComputerLogins(now);
    if (waiting.length > 0) {
      lookAgain = Math.max(...waiting.map((login) => login.expiresAt));

      return;
    }

    secrets = [...secrets, ...(await beginSampleLogins(world))];
  };

  // One step at a time, each after the one before it: a page asked while tokens are being collected is answered after them.
  return () => {
    last = last.then(step, step);

    return last;
  };
}

/** Check the domain once as the admin, over a plug that finds every piece in place. */
async function checkDomain(world: World): Promise<void> {
  const settings = await world.install.database.readSettings();
  if (settings === undefined) throw new Error("the demo's seed lost its settings");

  await runDomain(previewPlug("done"), world.install, { run: "check", token: DOMAIN_TOKEN, settings: async () => settings, by: world.admin.holder, from: "dashboard" });
}

/**
 * Fill a fresh demo install with the sample data.
 *
 * @returns the admin token the API takes; the install's clock follows the machine's again
 * @param samples - the files of each sample site a draft names
 * @throws {Error} an action refused a step, or a sample is missing
 */
export async function seedWorld(world: World, samples: Samples): Promise<Seeded> {
  const start = world.install.now();
  const cast: Cast = { actors: people(world), tokens: new Map(), sites: new Map() };
  const moments = [
    ...SITES.map((draft) => ({ ago: draft.ago, run: () => makeSite(world, cast, draft, samples) })),
    ...HISTORY.map((moment) => ({ ago: moment.ago, run: () => play(world, cast, moment) })),
  ];

  // The oldest moment is played first, whatever list it stands in.
  for (const moment of moments.sort((left, right) => right.ago - left.ago)) {
    world.clock.held = start - Math.round(moment.ago * DAY_MS);
    await moment.run();
  }

  world.clock.held = undefined;
  await countRequests(world, start);
  await checkDomain(world);
  const issued = done(await issueToken(world.install, world.admin, { note: ADMIN_TOKEN, scope: "admin" }), "the admin token");

  return { token: issued.token };
}
