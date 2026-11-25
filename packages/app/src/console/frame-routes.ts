// The data routes of the frame around every screen: the newer release the install knows of, what its domain needs, what went wrong within a day, the start of an update, and the asking for a newer release.
//
//   GET  /frame          the version the install runs, the newer release or `null`, whether an update can be started from here, the version to go back to or `null`, the note on the domain or `null`, and the problems with the mark of each screen
//   POST /update         start the update: the host takes the newest release, or the one version the body names, and puts it in place
//   POST /update/check   ask the project's website now which version is the newest, and keep what was learned: the version the install runs, and the newer release or `null`

import { vValidator } from "@hono/valibot-validator";
import { domainSentence, domainStateOf } from "@poplin/core/src/actions/install/domain-state";
import type { Install } from "@poplin/core/src/actions/records";
import { type WayBack, wayBack } from "@poplin/core/src/actions/update/go-back";
import { startUpdate, UPDATE_REQUEST } from "@poplin/core/src/actions/start-update";
import { checkNow } from "@poplin/core/src/actions/update/check-update";
import { noticeIn, type Update, updateIn } from "@poplin/core/src/actions/update/update";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { Hono } from "hono";

import { NOTHING, refused, refuseInvalid, type Shared } from "./data";
import { type Marked, markedIn, NOTHING_MARKED } from "./problems/problems-routes";

/** What the side says in a few words when a piece of the domain needs work, when the users or who gets the alerts changed since the last repair, and when the last check is only old. */
const [NEEDS_FIXING, USERS_CHANGED, CHECK_IS_OLD] = ["Domain needs fixing", "Users or alerts changed", "Domain check is old"];

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
  /** The version the install runs now. A page that was loaded before an update reads the new one here, and offers no more what it learned of the old one. */
  readonly version: string;

  /** The newer release the install knows of, or `null`. */
  readonly update: Update | null;

  /** Whether an update can be started from the frame: the host holds the key an update is sent with. */
  readonly starts: boolean;

  /** The version the install can go back to and since when it runs the one it would leave, or `null` where there is no way back. */
  readonly back: WayBack | null;

  /** What the domain needs, or `null`: nothing is wrong, nothing was ever checked, or the console has no Domain screen to act on it. */
  readonly domainNote: DomainNote | null;
}

/** What the frame is read for. */
interface Asked {
  /** The version the install runs. */
  readonly version: string;

  /** What a sentence calls the install's side at the provider, as its Domain screen does; `undefined` for a console with no such screen. */
  readonly domain: string | undefined;

  /** Whether a change of the users is carried to the domain with no person, so one that waits is nothing to act on. */
  readonly selfCarried: boolean;

  /** Whether the host holds the key an update is sent with. */
  readonly keyed: boolean;

  /** The version the install can go back to, or `undefined` where there is no way back. */
  readonly back: WayBack | undefined;
}

/** What a frame holds beside the running version when it shows nothing of the install. */
const NOTHING_SHOWN: Omit<Frame, "version"> = { update: null, starts: false, back: null, domainNote: null, ...NOTHING_MARKED };

/** Word the note on the domain from what the install remembers of its last check. */
function domainNoteOf(state: ReturnType<typeof domainStateOf>, thing: string): DomainNote | null {
  if (state.note === "none") return null;

  const sentence = domainSentence(state.note, thing);
  if (state.note.code === "check_again") return { label: CHECK_IS_OLD, sentence, quiet: true };

  return { label: state.note.code === "users_changed" ? USERS_CHANGED : NEEDS_FIXING, sentence, quiet: false };
}

/**
 * Read what the frame shows, as one question to the database. It asks the provider nothing.
 *
 * @returns the frame of an install whose settings cannot be read has no release, no start, no note, and nothing marked
 */
export async function frameOf(install: Install, actor: Actor, asked: Asked): Promise<Frame> {
  const { version } = asked;
  if (actor.scope !== "admin") return { version, ...NOTHING_SHOWN };

  const read = await install.database.readFrame(install.now());
  // A request that brought the settings answers all it shows from those.
  const settings = install.knownSettings ?? read.settings;
  if (settings === undefined) return { version, ...NOTHING_SHOWN };

  // A change of the users that the install carries by itself is settled by a later try, and a try no later one mends is a problem of its own.
  const remembered = read.domainCheck !== undefined && asked.selfCarried ? { ...read.domainCheck, users_changed_at: null } : read.domainCheck;
  const domainNote = asked.domain === undefined ? null : domainNoteOf(domainStateOf(remembered, install.now()), asked.domain);
  // What the domain needs marks its screen as a problem there does. A check that is only old is a reminder, and marks nothing.
  const marked = markedIn(read.problems, install.now(), { screen: asked.domain !== undefined, says: domainNote === null || domainNote.quiet ? null : domainNote.sentence });

  return { version, update: updateIn({ settings, updateCheck: read.updateCheck }, version) ?? null, starts: asked.keyed, back: asked.back ?? null, domainNote, ...marked };
}

/** The frame's data routes. */
export const frameRoutes = new Hono<Shared>()
  .get("/frame", async (context) => {
    const { install, actor } = context.get("asker");

    const { version, updating } = context.get("host");
    const asked = { version, domain: context.get("domain")?.words.thing, selfCarried: context.get("follow")?.holdsKey() === true, keyed: updating.self.holdsKey(), back: wayBack(updating.self.last, version) };

    return context.json({ ok: true as const, ...(await frameOf(install, actor, asked)) });
  })
  .post("/update", vValidator("json", UPDATE_REQUEST, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { version, updating } = context.get("host");
    const started = await startUpdate(install, actor, { version, to: context.req.valid("json").to }, updating);

    return started.ok ? context.json({ ok: true as const, to: started.to }) : refused(context, started);
  })
  .post("/update/check", vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { version, updating, latest } = context.get("host");
    const checked = await checkNow(install, actor, latest, updating.counters);
    if (!checked.ok) return refused(context, checked);

    // The release is answered whatever `update_check` says: the frame's notice follows the setting, and this is the answer to a person who asked.
    // The answer is said of the version the install runs now, and names it: a page holds the answer only for as long as the frame names the same version.
    return context.json({ ok: true as const, version, update: noticeIn(checked, version) ?? null });
  });
