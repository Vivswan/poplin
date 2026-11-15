// What is done on the Access screen: a waiting login is allowed or denied, a person is added or taken out, a token is removed. Each change is sent and its result said in one line.

import type { Review, Token } from "@/access/access-queries";
import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused, send } from "@/lib/notify";

/** What each decision says once it is done. */
const DECIDED = {
  allowed: "Allowed. The computer collects its token within a few seconds, and then shows under Computers and agents.",
  lowered: "Allowed, for its own sites only. The computer collects its token within a few seconds, and then shows under Computers and agents.",
  denied: "Denied. The computer was not logged in.",
} as const;

/** How long after a login is allowed its computer has surely asked for its token, in milliseconds: it asks every five seconds. */
const COLLECTED_AFTER_MS = 6000;

/** What a person's change says once it is done. */
const PEOPLE_SAID = {
  added: "Added. One more step before this person can log in: open Settings, then Domain, paste a token, and press Repair.",
  removed: "Removed. That person can no longer log in.",
} as const;

/** What a decision about a login asks for. */
interface Decision {
  /** Whether the computer is let in. */
  readonly allow: boolean;

  /** Whether the box that says the codes match is ticked. */
  readonly confirm: boolean;

  /** What an allowed computer may change. */
  readonly scope: Review["scope"];
}

/**
 * How a decision ended. `box` is a refusal to say at the tick box, with its sentence; `gone` a login that no longer waits; `refused` any other refusal. The last two were said in a line.
 */
export type Decided = { readonly kind: "done" | "gone" | "refused" } | { readonly kind: "box"; readonly sentence: string };

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
 */
export function accessActions(onChanged: () => void): AccessActions {
  const removePerson: AccessActions["removePerson"] = async (email) => {
    const done = await send(api.people.remove.$post({ json: { login: email } }));
    if (done === undefined) return;

    onChanged();
    sayDone(PEOPLE_SAID.removed);
  };

  return {
    removePerson,
    decide: async (login, decision) => {
      const { allow, confirm, scope } = decision;

      try {
        await answerOf(api.logins.decide.$post({ json: { code: login.code, allow, confirm, ...(allow ? { scope } : {}) } }));
      } catch (error) {
        if (!(error instanceof Refused)) throw error;

        if (error.code === "not_confirmed") return { kind: "box", sentence: error.message };

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
    copyCommand: async (command) => {
      try {
        await navigator.clipboard.writeText(command);
        sayDone("Copied.");
      } catch {
        sayRefused("Not copied. Select the command and copy it.");
      }
    },
  };
}
