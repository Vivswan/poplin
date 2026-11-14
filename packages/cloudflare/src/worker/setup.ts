// The setup page of a real install: the token form of a Worker nobody has logged in to yet.
//
//   the first settings, setup's own runs   ->  open
//   any other entry in the audit log       ->  shut, for good
//
// Every other entry is written for a logged-in admin or for a token an admin issued, so the first of them means somebody has logged in.
// The page answers on the admin hostname and on the Worker's own workers.dev address, which is the only one that resolves before setup made the records.

import { createSetup } from "@poplin/app/src/dashboard/domain/setup";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import type { Database } from "@poplin/core/src/database/database";
import type { AuditEntry } from "@poplin/core/src/records/audit";
import { clientAddress } from "../limits/client-address";
import type { Held } from "./held";
import type { Instance } from "./start";

/** How many audit entries one read asks for: the most the database gives. */
const PAGE = 100;

/** Where the setup page answers; its two runs are one level below. */
const SETUP_PATH = "/setup";

function isSetupsOwn(entry: AuditEntry): boolean {
  if (entry.action === "settings_set") return true;

  return entry.action === "domain_synced" && entry.detail.from === "setup";
}

/**
 * Decide whether a path is the setup page's.
 *
 * @returns `true` for `/setup` and everything below it
 */
export function isSetupPath(pathname: string): boolean {
  return pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`);
}

/**
 * Decide whether nobody has ever logged in to the install.
 *
 * @returns `true` while the audit log holds the first settings and setup's own runs and nothing else; it reads on past a full page only while every entry so far is one of those
 * @throws whatever the database rejects with
 */
export async function neverLoggedIn(database: Pick<Database, "listAudit">): Promise<boolean> {
  let before: number | undefined;

  for (;;) {
    const entries = await database.listAudit(before === undefined ? { limit: PAGE } : { limit: PAGE, before });
    if (!entries.every(isSetupsOwn)) return false;

    const last = entries.at(-1);
    if (entries.length < PAGE || last === undefined) return true;

    before = last.seq;
  }
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
