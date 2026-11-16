// The sample data of the demo, made through the product's own actions: tokens, the sites of `sample-sites.ts` published from the sample sites the host hands in, settings above a free limit, logins, the day's requests, and a check of the domain.
//
// The check finds every piece in place, so the install remembers a healthy domain. A Check on the Domain screen finds pieces to repair and replaces that memory; a reset brings the healthy one back.
//
// Every name and address is invented. The history is played in the order of its moments, so the audit log rises in time with its sequence, as a real install's does.

import { beginLogin, decideLogin, redeemLogin } from "../../../core/src/actions/computer-logins";
import { parseLoginSecret } from "../../../core/src/auth/computer-logins";
import { changeConfig } from "../../../core/src/actions/config";
import { deleteSite } from "../../../core/src/actions/delete";
import { listSites } from "../../../core/src/actions/list";
import { issueToken, revokeToken } from "../../../core/src/actions/manage-tokens";
import { newLink } from "../../../core/src/actions/new-link";
import { publishSite } from "../../../core/src/actions/publish";
import { signedBy } from "../../../core/src/actions/reach";
import { runDomain } from "../../../app/src/console/domain/domain-run";
import { restoreSite } from "../../../core/src/actions/restore";
import { updateSite } from "../../../core/src/actions/set";
import { parseLogin } from "../../../core/src/auth/logins";
import type { Actor } from "../../../core/src/auth/scopes";
import { standingPlug } from "./domain-plug";
import { type Draft, SITE_HISTORY, type SiteMoment, SITES, THE_DEMO, type Who } from "./sample-sites";
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

/** Today's requests, the opens of a page among them, and how many days back a share of both is counted, by the name of the site. Together today's are nine tenths of the day's limit, so a line near its limit shows. */
const COUNTED: Readonly<Record<string, readonly [requests: number, views: number, days: number]>> = {
  "sales-report": [1_860, 410, 365],
  lisbon: [214_259, 14_800, 200],
  handbook: [8_415, 2_150, 365],
  "launch-deck": [240, 64, 120],
  pricing: [130, 38, 45],
  "team-site": [96, 31, 90],
};

/** The share of a weekday's count a Saturday or a Sunday gets. */
const WEEKEND_SHARE = 0.8;

/** The days over which a site's count grew from a third to what it is today. */
const GROWTH_DAYS = 300;

/** The rows the sample database read for each of today's requests. */
const ROWS_READ_A_REQUEST = 9;

/** Today's requests for each row the sample database wrote. */
const REQUESTS_A_ROW_WRITTEN = 4;

/** The days the history of the sites and the people spans, the days before it one person was alone, and how many of those days pass from one check of the domain to the next. */
const [HISTORY_DAYS, EARLIER_DAYS, CHECK_EVERY] = [31, 170, 7];

/** What happened to the install besides the making of its sites, the oldest moment first. The settings end with a second login, a limit on the sites, and a day's requests above the provider's free limit, so its warning shows. */
const HISTORY: readonly PlainMoment[] = [
  { ago: 44.5, does: "token", by: "mira", note: "first setup", scope: "admin" },
  { ago: 30.9, does: "token", by: "mira", note: "report agent" },
  { ago: 30.8, does: "token", by: "mira", note: "travel agent" },
  { ago: 29.6, does: "settings", by: "mira", changes: { logins: ["mira@example.com", SECOND_ADMIN] } },
  { ago: 29.5, does: "login", by: "jonas" },
  { ago: 28.9, does: "domain", by: "mira", run: "check" },
  { ago: 28.8, does: "domain", by: "mira", run: "repair" },
  { ago: 26.5, does: "token", by: "jonas", note: "old laptop" },
  { ago: 25.1, does: "token", by: "jonas", note: "nightly build" },
  { ago: 24.8, does: "token", by: "mira", note: "intern laptop" },
  { ago: 24.4, does: "login", by: "mira" },
  { ago: 23.2, does: "login", by: "jonas" },
  { ago: 21.6, does: "login", by: "mira" },
  { ago: 17.3, does: "login", by: "jonas" },
  { ago: 14.1, does: "login", by: "mira" },
  { ago: 13.9, does: "revoke", by: "jonas", note: "intern laptop" },
  { ago: 12.4, does: "login", by: "jonas" },
  { ago: 11.2, does: "computer", by: "mira", computer: "design-laptop", allow: true },
  { ago: 10.6, does: "login", by: "jonas" },
  { ago: 7.9, does: "revoke", by: "mira", note: "old laptop" },
  { ago: 7.4, does: "login", by: "mira" },
  { ago: 6.1, does: "computer", by: "jonas", computer: "kiosk-display", allow: false },
  { ago: 4.3, does: "login", by: "mira" },
  { ago: 4.1, does: "revoke", by: "nightly build", note: "nightly build" },
  { ago: 2.9, does: "login", by: "jonas" },
  { ago: 1.8, does: "login", by: "jonas" },
  { ago: 1, does: "settings", by: "mira", changes: { max_sites: 40, requests_per_day: 250_000 } },
  { ago: 0.9, does: "login", by: "mira" },
  { ago: 0.3, does: "login", by: "jonas" },
];

/** The first person's own months before the history above: a login most days, and a check of the domain each week, so the log holds more entries than a page shows. */
const EARLIER: readonly Moment[] = Array.from({ length: EARLIER_DAYS }, (_day, index): Moment => {
  const ago = HISTORY_DAYS + EARLIER_DAYS - index;

  return index % CHECK_EVERY === 0 ? { ago, does: "domain", by: "mira", run: "check" } : { ago, does: "login", by: "mira" };
});

/** What went wrong in the sample install, by how many hours ago: failed requests that came in a storm, a clean-up that failed in two hours of the clock, a login that could not be checked, and a day's limit reached earlier in the week. */
const PROBLEMS = [
  { kind: "requests_limit_reached", hoursAgo: 50, count: 1, more: false, name: null, message: null },
  { kind: "login_unchecked", hoursAgo: 6, count: 1, more: false, name: null, message: null },
  { kind: "sweep_failed", hoursAgo: 5, count: 2, more: false, name: "Error", message: "the store did not answer" },
  { kind: "sweep_failed", hoursAgo: 3, count: 1, more: false, name: "Error", message: "the store did not answer" },
  { kind: "request_failed", hoursAgo: 0.7, count: 12, more: true, name: "TypeError", message: "the store did not answer in time" },
] as const;

/** The milliseconds of one hour. */
const HOUR_MS = 3_600_000;

/** How many days before now a seeded install was set up: a day before the oldest moment of its history, so its first entry is the log's oldest. */
export const SEEDED_DAYS = Math.ceil(Math.max(...[...SITES, ...SITE_HISTORY, ...HISTORY, ...EARLIER].map((moment) => moment.ago))) + 1;

/** The computers that stand behind the sample logins of one demo install. */
interface SampleComputers {
  /** A step to run before a page is answered: it collects the tokens of the logins a visitor allowed, and keeps a login waiting. */
  readonly keep: () => Promise<void>;

  /** The secret of each sample computer that has not collected its token yet. A host that saves the demo saves them too. */
  readonly secrets: () => readonly string[];
}

/** One file of a sample site, read whole by the host. */
interface SampleFile {
  /** Where the file sits in its site: segments joined by `/`. */
  readonly path: string;

  /** The media type the file is served with. */
  readonly contentType: string;

  /** The file's bytes. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** One sample site, read by the host as a publish reads a folder. */
interface Sample {
  /** The title of its entry page, which a publish sends beside the files; left out for a page with none. */
  readonly title?: string;

  /** Its files. */
  readonly files: readonly SampleFile[];
}

/** Every sample site, by the name of its folder under `demo/samples`. */
export type Samples = Readonly<Record<string, Sample>>;

/** A moment that touches no site: how many days ago it happens, what is done, and by whom. A token is a publisher's unless it names another scope. A `computer` asks to publish and is allowed or denied. */
type PlainMoment = { readonly ago: number; readonly by: Who } & (
  | { readonly does: "token"; readonly note: string; readonly scope?: "admin" }
  | { readonly does: "revoke"; readonly note: string }
  | { readonly does: "settings"; readonly changes: Readonly<Record<string, unknown>> }
  | { readonly does: "domain"; readonly run: "check" | "repair" }
  | { readonly does: "computer"; readonly computer: string; readonly allow: boolean }
  | { readonly does: "login" }
);

/** One moment of the history. */
type Moment = PlainMoment | SiteMoment;

/** A sample site as the history goes on with it: the label it has now, and what every publish of it sends: its files, and its entry page's own title where the page has one. */
interface Made {
  label: string;
  readonly sent: Pick<Parameters<typeof publishSite>[2], "files" | "page_title">;
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

/**
 * The site that stands for the demo itself: one page, which sends its visitor to the demo's dashboard and links there.
 *
 * @param home - the dashboard's first page as a page at the root of a public site links to it; an address or a relative path, with no quote in it
 */
function standIn(home: string): Sample {
  const page = `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=${home}">\n<title>poplin demo</title>\n<p><a href="${home}">Open the demo</a></p>\n`;

  return { title: "poplin demo", files: [{ path: "index.html", contentType: "text/html; charset=utf-8", bytes: new TextEncoder().encode(page) }] };
}

/** A sample by its name; a name the seed has no sample for is a mistake in the seed. */
function sampleOf(name: string, samples: Samples): Sample {
  const sample = samples[name];
  if (sample === undefined) throw new Error(`the demo's seed has no sample called ${name}`);

  return sample;
}

/**
 * What a draft publishes: its sample at the root, with that sample's own title as a publish reads it from the entry page, and every sample beside it under its folder.
 *
 * A site of many files shows what a small one cannot, such as a copy that takes more than one request.
 */
function sentOf(draft: Draft, samples: Samples): Made["sent"] {
  const placed = [["", draft.sample] as const, ...Object.entries(draft.beside ?? {}).map(([folder, sample]) => [`${folder}/`, sample] as const)];
  const files = placed.flatMap(([folder, sample]) =>
    sampleOf(sample, samples).files.map(({ path, contentType, bytes }) => ({ path: `${folder}${path}`, contentType, size: bytes.length, open: () => new Blob([bytes]).stream() })),
  );
  const { title } = sampleOf(draft.sample, samples);

  return title === undefined ? { files } : { files, page_title: title };
}

/** The two people of the install, each as an admin in a browser. */
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
  const sent = sentOf(draft, samples);
  const { site } = done(await publishSite(world.install, made(cast.actors, draft.by), { ...sent, name: draft.name, ...draft.settings }), draft.name);
  cast.sites.set(draft.name, { label: site.label, sent });
}

/** Do one thing to a site that is made, and keep the label it has after it. */
async function changeSite(world: World, cast: Cast, moment: SiteMoment): Promise<void> {
  const { install } = world;
  const actor = made(cast.actors, moment.by);
  const site = made(cast.sites, moment.site);
  const answers = {
    version: () => publishSite(install, actor, { ...site.sent, site: site.label }),
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
  const login = parseLoginSecret(asked.secret) ?? "";
  const decision = moment.allow ? ({ login, allow: true, scope: "publisher", letters: asked.code } as const) : ({ login, allow: false } as const);
  done(await decideLogin(install, made(cast.actors, moment.by), decision), `the decision on ${moment.computer}`);
  if (moment.allow) done(await redeemLogin(install, { secret: asked.secret }), `the token of ${moment.computer}`);
}

/** Do what one moment of the history says. A login and a run on the domain are written to the log as the pages that do them write them. */
async function play(world: World, cast: Cast, moment: Moment): Promise<void> {
  const { install } = world;
  const actor = made(cast.actors, moment.by);
  const signed = signedBy(actor, install.now());

  switch (moment.does) {
    case "token": {
      const scope = moment.scope ?? "publisher";
      const { record } = done(await issueToken(install, actor, { note: moment.note, scope }), `the token of ${moment.note}`);
      cast.tokens.set(moment.note, record.id);
      cast.actors.set(moment.note, { scope, holder: record.id });

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

/** The share of today's count a day got: less on a weekend, and less the longer ago it was. Today has the whole. */
function sharedOn(weekday: number, ago: number): number {
  if (ago === 0) return 1;

  const grown = 1 - (2 / 3) * Math.min(ago / GROWTH_DAYS, 1);

  return (weekday === 0 || weekday === 6 ? WEEKEND_SHARE : 1) * grown;
}

async function countRequests(world: World, start: number): Promise<void> {
  const listed = done(await listSites(world.install, world.admin), "the list of sites");

  for (const site of listed.sites) {
    const [requests, views, days] = COUNTED[site.public_name ?? site.name] ?? [0, 0, 0];

    for (let ago = 0; ago < days; ago += 1) {
      const moment = new Date(start - ago * DAY_MS);
      const share = sharedOn(moment.getUTCDay(), ago);
      // Today alone shows the rows the database used, so no earlier day is given any.
      const rows = ago === 0 ? { read: requests * ROWS_READ_A_REQUEST, written: Math.ceil(requests / REQUESTS_A_ROW_WRITTEN) } : undefined;
      await world.install.database.addRequests({ day: moment.toISOString().slice(0, DAY_LENGTH), site: site.id, requests: Math.ceil(requests * share), views: Math.floor(views * share), rows });
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
 * @param held - the secrets the sample computers of a demo saved before this one held, so the logins it left waiting are still theirs; none for a demo from the seed
 * @returns the sample computers. `keep` begins the sample logins when none waits, and looks again only once the last waiting login has run out, so logins a visitor just decided do not come back at once
 */
export function keepLoginsWaiting(world: World, held: readonly string[]): SampleComputers {
  let lookAgain = Number.NEGATIVE_INFINITY;
  let secrets = held;
  let last: Promise<void> = Promise.resolve();

  const step = async (): Promise<void> => {
    const now = world.install.now();
    secrets = await collectTokens(world, secrets);
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
  const keep = (): Promise<void> => {
    last = last.then(step, step);

    return last;
  };

  return { keep, secrets: () => secrets };
}

/** Note what went wrong in the sample install, each note as the install would have written it then. */
async function noteProblems(world: World, start: number): Promise<void> {
  for (const { hoursAgo, ...noted } of PROBLEMS) await world.install.database.noteProblem({ ...noted, at: start - Math.round(hoursAgo * HOUR_MS) });
}

/** Check the domain once as the admin, over a plug that finds every piece in place. */
async function checkDomain(world: World): Promise<void> {
  const settings = await world.install.database.readSettings();
  if (settings === undefined) throw new Error("the demo's seed lost its settings");

  await runDomain(standingPlug(world.kind.provider), world.install, { run: "check", token: DOMAIN_TOKEN, settings: async () => settings, by: world.admin.holder, from: "dashboard" });
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
  // No folder holds the sample of the demo's own row: its one page is written for the kind of install, which says where the dashboard is from a site.
  const given = { ...samples, [THE_DEMO]: standIn(world.kind.homeFromSite) };
  const moments = [
    ...SITES.map((draft) => ({ ago: draft.ago, run: () => makeSite(world, cast, draft, given) })),
    ...[...EARLIER, ...HISTORY, ...SITE_HISTORY].map((moment) => ({ ago: moment.ago, run: () => play(world, cast, moment) })),
  ];

  // The oldest moment is played first, whatever list it stands in.
  for (const moment of moments.sort((left, right) => right.ago - left.ago)) {
    world.clock.held = start - Math.round(moment.ago * DAY_MS);
    await moment.run();
  }

  world.clock.held = undefined;
  await countRequests(world, start);
  await checkDomain(world);
  await noteProblems(world, start);
  const issued = done(await issueToken(world.install, world.admin, { note: ADMIN_TOKEN, scope: "admin" }), "the admin token");

  return { token: issued.token };
}
