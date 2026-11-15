// The sample data of the demo, made through the product's own actions: tokens, sites published from the sample sites the host hands in, a site in the trash, settings above a free limit, logins, the day's requests, and a check of the domain.
//
// The check finds every piece in place, so the install remembers a healthy domain. A Check on the Domain tab finds pieces to repair and replaces that memory; a reset brings the healthy one back.
//
// Every name and address is invented. The actions write the audit log themselves, so the Activity tab shows what a real install would.

import type { SiteChanges } from "../../../core/src/actions/changes";
import { beginLogin } from "../../../core/src/actions/computer-logins";
import { changeConfig } from "../../../core/src/actions/config";
import { deleteSite } from "../../../core/src/actions/delete";
import { listSites } from "../../../core/src/actions/list";
import { issueToken } from "../../../core/src/actions/manage-tokens";
import { publishSite } from "../../../core/src/actions/publish";
import { runDomain } from "../../../app/src/dashboard/domain/domain-run";
import { updateSite } from "../../../core/src/actions/set";
import type { Actor } from "../../../core/src/auth/scopes";
import { previewPlug } from "./domain-plug";
import type { World } from "./world";

/** The milliseconds of one day. */
const DAY_MS = 86_400_000;

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** The agents that publish with a token of their own, by the note of each token. */
const PUBLISHERS = ["report agent", "travel agent"] as const;

/** The note of the admin token the terminal prints. An admin token runs out, so it is issued last, at the present moment. */
const ADMIN_TOKEN = "local preview";

/** The token the seed's check of the domain is run with. The preview's plug takes any, and nothing keeps it. */
const DOMAIN_TOKEN = "sample-token";

/** The settings laid over the defaults: a second login, and a day's requests above the provider's free limit, so its warning shows. */
const SETTINGS = { logins: ["mira@example.com", "jonas@example.com"], requests_per_day: 250_000 };

/** The requests counted today and the opens of a page among them, by the name of the site that answered them. Each earlier day of the week counts a share of them. */
const COUNTED: Readonly<Record<string, readonly [requests: number, views: number]>> = {
  "sales-report": [1_860, 410],
  lisbon: [61_240, 14_800],
  handbook: [8_415, 2_150],
  "launch-deck": [240, 64],
  pricing: [130, 38],
  "team-site": [96, 31],
};

/** The days the counts are seeded over: today and the six before it. */
const COUNTED_DAYS = 7;

/** Every sample site, in the order it is made. */
const SITES: readonly Draft[] = [
  { name: "handbook", sample: "trip-summary", by: "admin", daysAgo: 30, settings: { access: "public", title: "Team handbook", search_engines: true } },
  { name: "sales-report", sample: "sales-report", by: "report agent", daysAgo: 21, versions: 3, settings: { title: "Q3 sales report" } },
  { name: "old-notes", sample: "trip-summary", by: "travel agent", daysAgo: 15, trashedDaysAgo: 3, settings: { access: "unlisted", title: "Notes from the offsite" } },
  { name: "launch-deck", sample: "launch-deck", by: "admin", daysAgo: 12, settings: { access: "unlisted", title: "Launch deck" } },
  { name: "team-site", sample: "checkout-prototype", beside: { deck: "launch-deck", report: "sales-report" }, by: "admin", daysAgo: 10, settings: { title: "Team site" } },
  { name: "lisbon-trip", sample: "trip-summary", by: "travel agent", daysAgo: 9, settings: { access: "public", public_name: "lisbon", title: "Lisbon, four days" } },
  { name: "pricing-draft", sample: "sales-report", by: "report agent", daysAgo: 5, renamedTo: "pricing", settings: { access: "unlisted", embeddable: false } },
  { name: "spring-offer", sample: "checkout-prototype", by: "admin", daysAgo: 4, settings: { access: "unlisted", title: "Spring offer", expires: "1h" } },
  { name: "status-board", sample: "launch-deck", by: "admin", daysAgo: 2, settings: {} },
  { name: "checkout", sample: "checkout-prototype", by: "admin", daysAgo: 0, settings: { title: "Checkout prototype", expires: "2d" } },
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

/** One sample site: the sample it is published from, the samples it holds beside that one, each under a folder, who publishes it, and how long ago. */
interface Draft {
  readonly name: string;
  readonly sample: string;
  readonly beside?: Readonly<Record<string, string>>;
  readonly by: "admin" | (typeof PUBLISHERS)[number];
  readonly daysAgo: number;
  readonly versions?: number;
  readonly renamedTo?: string;
  readonly trashedDaysAgo?: number;
  readonly settings: SiteChanges;
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

/** The files a draft publishes: its sample at the root, and every sample beside it under its folder. A site of many files shows what a small one cannot, such as a copy that takes more than one request. */
function filesOf(draft: Draft, samples: Samples): readonly SampleFile[] {
  const placed = [["", draft.sample] as const, ...Object.entries(draft.beside ?? {}).map(([folder, sample]) => [`${folder}/`, sample] as const)];

  return placed.flatMap(([folder, sample]) => {
    const files = samples[sample];
    if (files === undefined) throw new Error(`the demo's seed has no sample called ${sample}`);

    return files.map((file) => ({ ...file, path: `${folder}${file.path}` }));
  });
}

/** Issue each publisher its token, and answer who publishes under each name of a draft's `by`. */
async function issuePublishers(world: World): Promise<ReadonlyMap<string, Actor>> {
  const actors = new Map<string, Actor>([["admin", world.admin]]);

  for (const note of PUBLISHERS) {
    const issued = done(await issueToken(world.install, world.admin, { note, scope: "publisher" }), `the token of ${note}`);
    actors.set(note, { scope: "publisher", holder: issued.record.id });
  }

  return actors;
}

/** Publish one sample site, every version of it, then rename it and move it to the trash when its draft says so. Each step happens at its own past moment. */
async function publishDraft(world: World, draft: Draft, by: { readonly actor: Actor; readonly files: readonly SampleFile[] }, start: number): Promise<void> {
  const { actor } = by;
  const files = by.files.map(({ path, contentType, bytes }) => ({ path, contentType, size: bytes.length, open: () => new Blob([bytes]).stream() }));

  world.clock.held = start - draft.daysAgo * DAY_MS;
  const made = done(await publishSite(world.install, actor, { files, name: draft.name, ...draft.settings }), draft.name);

  for (let version = 2; version <= (draft.versions ?? 1); version += 1) {
    world.clock.held += DAY_MS;
    done(await publishSite(world.install, actor, { files, site: made.site.label }), `${draft.name} v${version}`);
  }

  if (draft.renamedTo !== undefined) {
    world.clock.held += DAY_MS;
    done(await updateSite(world.install, world.admin, { site: made.site.label, name: draft.renamedTo }), `the new name of ${draft.name}`);
  }

  if (draft.trashedDaysAgo === undefined) return;

  world.clock.held = start - draft.trashedDaysAgo * DAY_MS;
  done(await deleteSite(world.install, world.admin, { site: made.site.label }), `the trash of ${draft.name}`);
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
  world.clock.held = start - SITES.reduce((most, draft) => Math.max(most, draft.daysAgo), 0) * DAY_MS;
  const actors = await issuePublishers(world);

  for (const draft of SITES) {
    const actor = actors.get(draft.by);
    if (actor === undefined) throw new Error(`the demo's seed has no token called ${draft.by}`);

    await publishDraft(world, draft, { actor, files: filesOf(draft, samples) }, start);
  }

  world.clock.held = start - DAY_MS;
  done(await changeConfig(world.install, world.admin, SETTINGS), "the settings");
  await world.install.database.appendAudit({ action: "login", detail: {} }, { by: world.admin.holder, at: world.clock.held });

  world.clock.held = undefined;
  await countRequests(world, start);
  await checkDomain(world);
  done(await beginLogin(world.install, { scope: "publisher", computer: "studio-laptop" }, "preview"), "the waiting login");
  const issued = done(await issueToken(world.install, world.admin, { note: ADMIN_TOKEN, scope: "admin" }), "the admin token");

  return { token: issued.token };
}
