// The setup page of a real install: the token form of a Worker nobody has logged in to yet.
//
//   nobody has logged in    ->  open
//   somebody has, ever      ->  shut, for good
//
// A login is an entry of the audit log, which only ever grows, so the page never opens again.
// The page answers on the admin hostname and, on an install with a domain, on the Worker's own workers.dev address, which is the only one that resolves before setup made the records.
// A Worker with nothing set answers the page on every hostname: it has no domain yet to tell one from another.
// There a person chooses the kind of install. One without a domain is set up from the Worker's own workers.dev address, whose account's name the install then answers under.

import { createSetupConsole } from "@poplin/app/src/console/setup-console";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { clientAddress } from "../limits/client-address";
import { CLIENT_FILES } from "./client-files";
import type { Held } from "./held";
import type { Instance, Unset } from "./start";

/** Where the setup page answers; its two runs are one level below. */
const SETUP_PATH = "/setup";

/**
 * Decide whether a path is the setup page's.
 *
 * @returns `true` for `/setup` and everything below it
 */
export function isSetupPath(pathname: string): boolean {
  return pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`);
}

/**
 * Answer a request to a Worker with nothing set: its setup page, which asks the kind of install and the first login, and from every other path the way there.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns the page's own answer. A run stores nothing here: what it changes is at Cloudflare, under the account of the token it was given
 */
export function answerFirstSetup(request: Request, unset: Unset, now: () => number): Promise<Response> {
  if (!isSetupPath(new URL(request.url).pathname)) return Promise.resolve(new Response(null, { status: 302, headers: { "Cache-Control": "no-store", Location: SETUP_PATH } }));

  const setup = createSetupConsole({
    client: CLIENT_FILES,
    install: { database: unset.database, now },
    domain: unset.first,
    open: async () => !(await unset.database.hasLoggedIn()),
    counters: unset.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), unset.secrets.visitorSecret, now()),
  });

  return setup.fetch(request);
}

/**
 * Answer a request to the setup page.
 *
 * @param held - reads the settings the instance holds
 * @param open - whether the page answers at all, asked on every request
 * @returns the page's own answer: a 404 that says nothing once the page is shut
 */
export async function answerSetup(request: Request, instance: Instance, held: () => Promise<Held>, open: () => Promise<boolean>): Promise<Response> {
  const { visitorSecret } = await held();
  const setup = createSetupConsole({
    client: CLIENT_FILES,
    install: instance.install,
    domain: instance.domain,
    open,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), visitorSecret, instance.install.now()),
  });

  return setup.fetch(request);
}
