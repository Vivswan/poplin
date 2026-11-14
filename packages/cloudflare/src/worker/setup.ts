// The setup page of a real install: the token form of a Worker nobody has logged in to yet.
//
//   nobody has logged in    ->  open
//   somebody has, ever      ->  shut, for good
//
// A login is an entry of the audit log, which only ever grows, so the page never opens again.
// The page answers on the admin hostname and on the Worker's own workers.dev address, which is the only one that resolves before setup made the records.

import { createSetup } from "@poplin/app/src/dashboard/domain/setup";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { clientAddress } from "../limits/client-address";
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
 * @param open - whether the page answers at all, asked on every request
 * @returns the page's own answer: a 404 that says nothing once the page is shut
 */
export function answerSetup(request: Request, instance: Instance, held: Held, open: () => Promise<boolean>): Promise<Response> {
  const setup = createSetup({
    install: instance.install,
    domain: instance.domain,
    open,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), held.visitorSecret, instance.install.now()),
    csrfSecret: held.formsSecret,
  });

  return setup.fetch(request);
}
