// The sample data of the demo, made through the product's own actions: tokens, sites published from the sample sites the host hands in, a site in the trash, settings above a free limit, logins, and the day's requests.
//
// Every name and address is invented. The actions write the audit log themselves, so the Activity tab shows what a real install would.

import type { SiteChanges } from "../../../packages/core/src/actions/changes";
import { beginLogin } from "../../../packages/core/src/actions/computer-logins";
import { changeConfig } from "../../../packages/core/src/actions/config";
import { deleteSite } from "../../../packages/core/src/actions/delete";
import { listSites } from "../../../packages/core/src/actions/list";
import { issueToken } from "../../../packages/core/src/actions/manage-tokens";
import { publishSite } from "../../../packages/core/src/actions/publish";
import { updateSite } from "../../../packages/core/src/actions/set";
import type { Actor } from "../../../packages/core/src/auth/scopes";
import type { World } from "./world";

/** The milliseconds of one day. */
const DAY_MS = 86_400_000;

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** The agents that publish with a token of their own, by the note of each token. */
const PUBLISHERS = ["report agent", "travel agent"] as const;

/** The note of the admin token the terminal prints. An admin token runs out, so it is issued last, at the present moment. */
const ADMIN_TOKEN = "local preview";

/** The settings laid over the defaults: a second login, and a day's requests above the provider's free limit, so its warning shows. */
const SETTINGS = { logins: ["mira@example.com", "jonas@example.com"], requests_per_day: 250_000 };

/** The requests counted today, by the name of the site that answered them. */
const REQUESTS: Readonly<Record<string, number>> = { "sales-report": 1_860, lisbon: 61_240, handbook: 8_415 };

/** Every sample site, in the order it is made. */
const SITES: readonly Draft[] = [
  { name: "handbook", sample: "trip-summary", by: "admin", daysAgo: 30, settings: { access: "public", title: "Team handbook", search_engines: true } },
  { name: "sales-report", sample: "sales-report", by: "report agent", daysAgo: 21, versions: 3, settings: { title: "Q3 sales report" } },
  { name: "old-notes", sample: "trip-summary", by: "travel agent", daysAgo: 15, trashedDaysAgo: 3, settings: { access: "unlisted", title: "Notes from the offsite" } },
  { name: "launch-deck", sample: "launch-deck", by: "admin", daysAgo: 12, settings: { access: "unlisted", title: "Launch deck" } },
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

/** One sample site: the sample it is published from, who publishes it, and how long ago. */
interface Draft {
  readonly name: string;
  readonly sample: string;
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
  const day = new Date(start).toISOString().slice(0, DAY_LENGTH);
  const listed = done(await listSites(world.install, world.admin), "the list of sites");

  for (const site of listed.sites) {
    const requests = REQUESTS[site.public_name ?? site.name];
    if (requests !== undefined) await world.install.database.addRequests({ day, site: site.id, requests });
  }
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
    const files = samples[draft.sample];
    if (actor === undefined || files === undefined) throw new Error(`the demo's seed has no token called ${draft.by}, or no sample called ${draft.sample}`);

    await publishDraft(world, draft, { actor, files }, start);
  }

  world.clock.held = start - DAY_MS;
  done(await changeConfig(world.install, world.admin, SETTINGS), "the settings");
  await world.install.database.appendAudit({ action: "login", detail: {} }, { by: world.admin.holder, at: world.clock.held });

  world.clock.held = undefined;
  await countRequests(world, start);
  done(await beginLogin(world.install, { scope: "publisher", computer: "studio-laptop" }, "preview"), "the waiting login");
  const issued = done(await issueToken(world.install, world.admin, { note: ADMIN_TOKEN, scope: "admin" }), "the admin token");

  return { token: issued.token };
}
