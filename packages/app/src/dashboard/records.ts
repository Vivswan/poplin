// What every dashboard page and change is handed, and what a page hands back.

import type { Install } from "@poplin/core/src/actions/records";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { html } from "hono/html";

/** Markup the `html` helper built: every value put into it was escaped. */
export type Html = ReturnType<typeof html>;

/** The tabs of the dashboard, in the order they are shown. The last is there only on a dashboard built with a domain plug. */
export type Tab = "sites" | "settings" | "activity" | "usage" | "domain";

/** The fields of a posted form, by name; of a name sent twice the last value. */
export type Form = ReadonlyMap<string, string>;

/** One request of a logged-in admin. */
export interface Visit {
  /** The install the actions work on. */
  readonly install: Install;

  /** The admin behind the session. */
  readonly actor: Actor;

  /** The address that was asked for. */
  readonly url: URL;

  /** The token every form of the answer carries back. */
  readonly csrf: string;

  /** Where a visitor without a session goes to log in. */
  readonly login: string;
}

/** A page before the frame goes around it. `status` is 200 when left out. */
export interface Page {
  readonly tab: Tab;
  readonly heading: string;
  readonly body: Html;
  readonly status?: 403 | 404 | 405 | 413 | 415 | 429 | 502;
}

/** A change a form asks for, about the subjects its address names. It answers where the browser goes next: a dashboard path that carries the result. */
export type Change<Subject extends unknown[] = []> = (visit: Visit, ...rest: [...Subject, Form]) => Promise<string>;
