// The data routes of the frame around every screen: the newer release the install knows of, what its domain needs, what went wrong within a day, and the start of an update.
//
//   GET  /frame    the newer release or `null`, whether an update can be started from here, the note on the domain or `null`, and the problems with the mark of each screen
//   POST /update   start the update: one request to the saved address

import { vValidator } from "@hono/valibot-validator";
import { DOMAIN_SENTENCES, domainStateOf } from "@poplin/core/src/actions/domain-state";
import type { Install } from "@poplin/core/src/actions/records";
import { startUpdate } from "@poplin/core/src/actions/start-update";
import { type Update, updateIn } from "@poplin/core/src/actions/update";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { Hono } from "hono";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";
import { type Marked, markedIn, NOTHING_MARKED } from "./problems-routes";

/** What the side says in a few words when a piece of the domain needs work, when the users changed since the last repair, and when the last check is only old. */
const [NEEDS_FIXING, USERS_CHANGED, CHECK_IS_OLD] = ["Domain needs fixing", "Users changed", "Domain check is old"];

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
interface Frame extends Marked {
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

/** A frame that shows nothing of the install. */
const NO_FRAME: Frame = { update: null, starts: false, domainNote: null, ...NOTHING_MARKED };

/** Word the note on the domain from what the install remembers of its last check. */
function domainNoteOf(state: ReturnType<typeof domainStateOf>): DomainNote | null {
  if (state.note === "none") return null;

  const { code } = state.note;
  if (code === "check_again") return { label: CHECK_IS_OLD, sentence: DOMAIN_SENTENCES[code], quiet: true };

  return { label: code === "users_changed" ? USERS_CHANGED : NEEDS_FIXING, sentence: DOMAIN_SENTENCES[code], quiet: false };
}

/**
 * Read what the frame shows, as one question to the database. It asks the provider nothing.
 *
 * @returns the frame of an install whose settings cannot be read has no release, no start, no note, and nothing marked
 */
export async function frameOf(install: Install, actor: Actor, asked: Asked): Promise<Frame> {
  if (actor.scope !== "admin") return NO_FRAME;

  const read = await install.database.readFrame(install.now());
  // A request that brought the settings answers all it shows from those.
  const settings = install.knownSettings ?? read.settings;
  if (settings === undefined) return NO_FRAME;

  const domainNote = asked.domain ? domainNoteOf(domainStateOf(read.domainCheck, install.now())) : null;
  // What the domain needs marks its screen as a problem there does. A check that is only old is a reminder, and marks nothing.
  const marked = markedIn(read.problems, install.now(), { screen: asked.domain, says: domainNote === null || domainNote.quiet ? null : domainNote.sentence });

  return { update: updateIn({ settings, updateCheck: read.updateCheck }, asked.version) ?? null, starts: read.updateAddress !== undefined, domainNote, ...marked };
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
