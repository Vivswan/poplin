// The Worker's own place at Cloudflare: the account it runs in and the name it runs under, as its two variables hold them.
// Setup acts on that account alone, so neither is ever taken from a request.

import { INSTALL_OBJECTS } from "../zone/install-objects";

/** An account id as Cloudflare writes one: 32 lowercase hexadecimal characters. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** A Worker's name as Cloudflare takes one: lowercase letters, digits, dashes, and underscores, 63 at most. */
const WORKER_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** The two variables, as the runtime hands them over. */
interface OwnVariables {
  readonly accountId: unknown;
  readonly script: unknown;
}

/** A variable that is not usable: `absent` for one never set, `bad-shape` for anything but a text of the right form. */
interface RefusedVariable {
  readonly binding: typeof INSTALL_OBJECTS.accountBinding | typeof INSTALL_OBJECTS.workerBinding;
  readonly refusal: "absent" | "bad-shape";
}

/** The Worker's account and name, or every one of the two variables that is refused. */
type ReadOwnWorker = { readonly ok: true; readonly value: { readonly accountId: string; readonly script: string } } | { readonly ok: false; readonly refused: readonly RefusedVariable[] };

function refusalOf(value: unknown, form: RegExp): RefusedVariable["refusal"] | undefined {
  if (value === undefined) return "absent";

  if (typeof value !== "string" || !form.test(value)) return "bad-shape";

  return undefined;
}

/**
 * Read the Worker's account id and name.
 *
 * @returns both, each safe to write into the path of a call to Cloudflare, or the refused ones; nothing throws
 */
export function readOwnWorker(variables: OwnVariables): ReadOwnWorker {
  const account = refusalOf(variables.accountId, ACCOUNT_ID);
  const worker = refusalOf(variables.script, WORKER_NAME);
  const refused: RefusedVariable[] = [];
  if (account !== undefined) refused.push({ binding: INSTALL_OBJECTS.accountBinding, refusal: account });

  if (worker !== undefined) refused.push({ binding: INSTALL_OBJECTS.workerBinding, refusal: worker });

  if (refused.length > 0) return { ok: false, refused };

  return { ok: true, value: { accountId: String(variables.accountId), script: String(variables.script) } };
}
