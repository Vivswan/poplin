// What is done on the Access screen: a waiting login is allowed or denied, a person is added or taken out, a token is removed, every browser is signed out. Each change is sent and its result said in one line.

import type { Review, Token } from "@/access/access-queries";
import { answerOf, api, Refused } from "@/lib/api";
import { copy, sayDone, sayRefused, send } from "@/lib/notify";

/** What each decision says once it is done. */
const DECIDED = {
  allowed: "Allowed. Its token shows here in a few seconds.",
  lowered: "Allowed, for its own sites only. Its token shows here in a few seconds.",
  denied: "Denied. The computer was not logged in.",
} as const;

/** How long after a login is allowed its computer has surely asked for its token, in milliseconds: it asks every five seconds. */
const COLLECTED_AFTER_MS = 6000;

/** What a person's change says once it is done. */
const PEOPLE_SAID = {
  added: "Added. Next, open Domain and press Repair.",
  removed: "Removed. Next, open Domain and press Repair.",
  gone: "That user was removed already.",
} as const;

/** What a decision about a login asks for. */
interface Decision {
  /** Whether the computer is let in. */
  readonly allow: boolean;

  /** Whether the person typed the code's last letters, which says the login is their own. */
  readonly confirm: boolean;

  /** What an allowed computer may change. */
  readonly scope: Review["scope"];
}

/** How a decision ended: `gone` is a login that no longer waits, `refused` any other refusal. Both were said in a line. */
export type Decided = { readonly kind: "done" | "gone" | "refused" };

/** The changes of the Access screen. */
export interface AccessActions {
  /** Allows or denies the login under review. */
  readonly decide: (login: Review, decision: Decision) => Promise<Decided>;

  /** Adds a person. It answers the sentence of a refusal, which is shown at the field, or nothing when the person was added. */
  readonly addPerson: (email: string) => Promise<string | undefined>;

  /** Takes a person out. */
  readonly removePerson: (email: string) => Promise<void>;

  /** Removes a token, which stops working at once. */
  readonly removeToken: (token: Token) => Promise<void>;

  /** Copies the command that logs a computer in, and says so. */
  readonly copyCommand: (command: string) => Promise<void>;

  /** Ends every session of the dashboard, this one included: the page is then asked for again, which leads to the login. */
  readonly signEveryoneOut: () => Promise<void>;
}

/** The line of a done decision: a computer that asked for everything and got less is told apart. */
function decisionWords(login: Review, decision: Decision): string {
  if (!decision.allow) return DECIDED.denied;

  return login.scope === "admin" && decision.scope === "publisher" ? DECIDED.lowered : DECIDED.allowed;
}

/**
 * Build the changes of the Access screen.
 *
 * @param onChanged - called after every done change, and after a login turned out to be gone, so the lists read again
 * @param onUsersChanged - called after a person was added or taken out, which the domain then waits a repair for, so what is said of the domain reads again
 */
export function accessActions(onChanged: () => void, onUsersChanged: () => void): AccessActions {
  // A person someone else took out meanwhile is gone as asked: that is said plainly, and is no refusal.
  const removePerson: AccessActions["removePerson"] = async (email) => {
    try {
      await answerOf(api.people.remove.$post({ json: { login: email } }));
    } catch (error) {
      if (!(error instanceof Refused)) throw error;

      if (error.code !== "not_a_login") return sayRefused(error.message);

      onChanged();

      return sayDone(PEOPLE_SAID.gone);
    }

    onChanged();
    onUsersChanged();
    sayDone(PEOPLE_SAID.removed);
  };

  return {
    removePerson,
    decide: async (login, decision) => {
      const { allow, confirm, scope } = decision;

      try {
        await answerOf(api.logins.decide.$post({ json: allow ? { code: login.code, allow, confirm, scope } : { code: login.code, allow } }));
      } catch (error) {
        if (!(error instanceof Refused)) throw error;

        sayRefused(error.message);
        if (error.code !== "no_such_login") return { kind: "refused" };

        onChanged();

        return { kind: "gone" };
      }

      onChanged();
      // An allowed computer asks for its token every few seconds: the tokens are read once more when it has had the time.
      if (allow) window.setTimeout(onChanged, COLLECTED_AFTER_MS);

      sayDone(decisionWords(login, decision));

      return { kind: "done" };
    },
    addPerson: async (email) => {
      // A refused email is said at its field, where it is corrected.
      try {
        const added = await answerOf(api.people.add.$post({ json: { login: email } }));
        onChanged();
        onUsersChanged();
        sayDone(PEOPLE_SAID.added, { run: () => void removePerson(added.login) });

        return undefined;
      } catch (error) {
        if (error instanceof Refused) return error.message;

        throw error;
      }
    },
    removeToken: async (token) => {
      const done = await send(api.tokens[":token"].remove.$post({ param: { token: token.id }, json: {} }));
      if (done === undefined) return;

      onChanged();
      sayDone("Removed. Its token works nowhere now.");
    },
    copyCommand: (command) => copy(command, { done: "Copied.", failed: "Not copied. Select the command and copy it." }),
    signEveryoneOut: async () => {
      const done = await send(api.settings["sign-everyone-out"].$post({ json: {} }));
      if (done !== undefined) window.location.reload();
    },
  };
}
