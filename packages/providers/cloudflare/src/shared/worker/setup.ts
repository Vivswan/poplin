// The setup page of a real install: the token form of a Worker nobody has logged in to yet, and after that the way back in when the login is broken.
//
//   nobody has logged in    the token, a corrected first login
//   somebody has, ever      the token alone: a repair
//
// A login is an entry of the audit log, which only ever grows, so no first login is corrected here once there is one.
// The page answers on the admin hostname and, on an install with a domain, on the Worker's own workers.dev address, which is the only one that resolves before setup made the records.

import { createSetupConsole } from "@poplin/app/src/console/setup-console";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { clientAddress } from "../limits/client-address";
import { CLIENT_FILES } from "./client-files";
import type { Held } from "./held";
import type { Instance } from "./start";

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
 * Answer a request to the setup page.
 *
 * @param held - reads the settings the instance holds
 * @param loggedIn - whether anybody has ever logged in, asked on every request
 * @returns the page's own answer: once somebody has logged in, the form that takes a token alone
 */
export async function answerSetup(request: Request, instance: Instance, held: () => Promise<Held>, loggedIn: () => Promise<boolean>): Promise<Response> {
  const { visitorSecret } = await held();
  const setup = createSetupConsole({
    client: CLIENT_FILES,
    install: instance.install,
    domain: instance.domain,
    loggedIn,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), visitorSecret, instance.install.now()),
  });

  return setup.fetch(request);
}
