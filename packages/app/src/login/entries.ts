// The Activity line of a login: one for each login at the provider, however many requests that login then carries.
//
//   a page opened under a login that began under five minutes ago  ->  one `login` entry, unless one of that email stands since the login began
//   a page opened under an older login                             ->  nothing, once the instance knows that somebody has logged in
//
// The dashboard keeps no session, so the provider's login is told apart by the moment it began. What an instance has noted it asks the database about no more.

import { noteProblem } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Login } from "@poplin/core/src/auth/logins";

/** How long after a login began a page still writes its line, in milliseconds. A later page is the same login at work, and writes nothing. */
const NEW_FOR_MS = 5 * 60_000;

/** Who opened a page, and `since`, when the provider's login behind it began, in milliseconds since the epoch. */
interface Entered {
  readonly email: Login;
  readonly since: number;
}

/**
 * Make what writes the logins of one instance to the audit log.
 *
 * The first entry is what ends the setup page's correction of the first login, so a database that refuses it lets nobody in, however old the login grows meanwhile.
 * Every later one is a record alone: a database that refuses it and still reads keeps the person, and the entry is given up, once, with a problem noted.
 *
 * @param report - told of an entry that was given up
 * @returns what a console is told every opened page through; it rejects with whatever the database rejects the first login's entry with, or the question of whether there was one
 */
export function createEntries(install: Pick<Install, "database" | "now">, report: (error: unknown) => void): (who: Entered) => Promise<void> {
  const noted = new Map<Login, number>();
  const noting = new Map<string, Promise<void>>();
  let somebodyHas = false;
  let asking: Promise<boolean> | undefined;

  // A login is never undone, so an instance that saw one asks the database no more. Pages that arrive together share the one question.
  function hasLoggedIn(): Promise<boolean> {
    if (somebodyHas) return Promise.resolve(true);

    asking ??= install.database
      .hasLoggedIn()
      .then((found) => {
        // A login written while the question was out is not unlearned by its older answer.
        somebodyHas ||= found;

        return somebodyHas;
      })
      .finally(() => {
        asking = undefined;
      });

    return asking;
  }

  async function note({ email, since }: Entered, now: number): Promise<void> {
    if (now - since > NEW_FOR_MS && (await hasLoggedIn())) return;

    try {
      // A login the provider dated a moment ahead of this clock is written at its own time, or the next instance would not find it.
      await install.database.noteLogin(email, { since, at: Math.max(now, since) });
      somebodyHas = true;
    } catch (error) {
      if (!(await hasLoggedIn())) throw error;

      report(error);
      await noteProblem(install, "login_unwritten", error);
    }

    // A line that was given up is not tried again: a database that takes no more writes would be asked at every page.
    // The newest login noted stays the one remembered, whichever of two finishes last.
    noted.set(email, Math.max(since, noted.get(email) ?? since));
  }

  return async (who) => {
    if ((noted.get(who.email) ?? Number.NEGATIVE_INFINITY) >= who.since) return;

    // Pages that arrive together under one login share its one statement.
    const key = `${who.email} ${who.since}`;
    const pending = noting.get(key) ?? note(who, install.now()).finally(() => noting.delete(key));
    noting.set(key, pending);

    await pending;
  };
}
