// The data routes of the frame around every screen: the install's title, the newer release it knows of, what its domain needs, and the start of an update.
//
//   GET  /frame    the title, the newer release or `null`, whether an update can be started from here, and the note on the domain or `null`
//   POST /update   start the update: one request to the saved address

import { vValidator } from "@hono/valibot-validator";
import { readConfig } from "@poplin/core/src/actions/config";
import { DOMAIN_SENTENCES, domainState } from "@poplin/core/src/actions/domain-state";
import type { Install } from "@poplin/core/src/actions/records";
import { startUpdate } from "@poplin/core/src/actions/start-update";
import { type Update, updateOf } from "@poplin/core/src/actions/update";
import { updateAddressState } from "@poplin/core/src/actions/update-address";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { Hono } from "hono";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";

/** The title of a frame whose settings cannot be read. */
const PLAIN_TITLE = "poplin";

/** What the side says in a few words when a piece of the domain needs work, and when the last check is only old. */
const [NEEDS_FIXING, CHECK_IS_OLD] = ["Domain needs fixing", "Domain check is old"];

/** The one thing to act on at the domain, as the side shows it. */
interface DomainNote {
  /** The few words the side shows. */
  readonly label: string;

  /** The whole sentence: what is wrong, and what to press. */
  readonly sentence: string;

  /** Whether it is only a reminder, which is never drawn as an alarm. */
  readonly quiet: boolean;
}

/** What the frame shows of the install. */
interface Frame {
  /** The install's title. */
  readonly title: string;

  /** The newer release the install knows of, or `null`. */
  readonly update: Update | null;

  /** Whether an address that starts a rebuild is saved, so an update can be started from the frame. */
  readonly starts: boolean;

  /** What the domain needs, or `null`: nothing is wrong, nothing was ever checked, or the console has no Domain screen to act on it. */
  readonly domainNote: DomainNote | null;
}

/** What the frame is read for. */
interface Asked {
  /** The version the install runs. */
  readonly version: string;

  /** Whether the console has a Domain screen. */
  readonly domain: boolean;
}

/** Read the note on the domain from what the install remembers of its last check. It asks the provider nothing. */
async function domainNoteOf(install: Install, actor: Actor): Promise<DomainNote | null> {
  const state = await domainState(install, actor);
  if (!state.ok || state.note === "none") return null;

  const quiet = state.note.code === "check_again";

  return { label: quiet ? CHECK_IS_OLD : NEEDS_FIXING, sentence: DOMAIN_SENTENCES[state.note.code], quiet };
}

/**
 * Read what the frame shows.
 *
 * @returns the frame of an install whose settings cannot be read has the plain title, no release, no start, and no note
 */
export async function frameOf(install: Install, actor: Actor, asked: Asked): Promise<Frame> {
  const config = await readConfig(install, actor);
  if (!config.ok) return { title: PLAIN_TITLE, update: null, starts: false, domainNote: null };

  const address = await updateAddressState(install, actor);
  const domainNote = asked.domain ? await domainNoteOf(install, actor) : null;

  return { title: config.values.dashboard_title, update: (await updateOf(install, asked.version, config.values)) ?? null, starts: address.ok && address.set, domainNote };
}

/** The frame's data routes. */
export const frameRoutes = new Hono<Shared>()
  .get("/frame", async (context) => {
    const { install, actor } = context.get("asker");

    const asked = { version: context.get("host").version, domain: context.get("domain") !== undefined };

    return context.json({ ok: true as const, ...(await frameOf(install, actor, asked)) });
  })
  .post("/update", vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { version, rebuilding } = context.get("host");
    const started = await startUpdate(install, actor, { version }, rebuilding);

    return started.ok ? context.json({ ok: true as const, to: started.to }) : refused(context, started);
  });
