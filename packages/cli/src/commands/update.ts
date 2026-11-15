// `poplin update`: ask the install to start its own rebuild, which deploys the newest release, or save and remove the address it starts that rebuild at.
//
// The address is read from the environment alone: never from an argument, which a process list shows. The install keeps it and never answers with it.

import { WHOAMI_ANSWER } from "../../../core/src/actions/manage-tokens";
import { STARTED_UPDATE } from "../../../core/src/actions/start-update";
import { UPDATE_ADDRESS_STATE } from "../../../core/src/actions/update-address";
import type { Failure } from "../client/client";
import { problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { dayText } from "./text";

/** The environment variable the address is read from. */
const ADDRESS_VARIABLE = "POPLIN_UPDATE_ADDRESS";

/** What goes with an address the install did not take. */
const NOT_TAKEN = "the install takes its own provider's update link, starting with https://, and no other";

/** The two facts of an answer about the address, and no other key of it: an install that sent the address back is not repeated. */
function stateOf(answer: { readonly set: boolean; readonly since: number | null }): { readonly set: boolean; readonly since: number | null } {
  return { set: answer.set, since: answer.since };
}

function failed(failure: Failure): Outcome {
  return { ok: false, problem: problemOf(failure) };
}

async function start(anyway: boolean, { client }: Session): Promise<Outcome> {
  const started = await client.call(STARTED_UPDATE, (api) => api.update.$post({ query: anyway ? { anyway: "true" } : {} }));
  if (!started.ok) return failed(started.failure);

  const { from, to } = started.value;
  const value = { started: true, from, to };
  const newest = to === null ? "no newer version is known" : `${to} is the newest version`;

  return { ok: true, value, lines: [`a build of the install has started; ${newest}, and the install runs ${from} until the build is done`] };
}

async function save({ client, io }: Session): Promise<Outcome> {
  const address = io.machine.env[ADDRESS_VARIABLE] ?? "";
  if (address === "") return { ok: false, problem: problem("no_address_to_save") };

  const saved = await client.call(UPDATE_ADDRESS_STATE, (api) => api.update.address.$put({ json: { address } }));
  if (saved.ok) return { ok: true, value: stateOf(saved.value), lines: ["the update link is saved; to update: poplin update"] };

  if (saved.failure.kind === "refused" && saved.failure.code === "bad_argument") return { ok: false, problem: problem("bad_argument", ADDRESS_VARIABLE, NOT_TAKEN) };

  return failed(saved.failure);
}

async function forget({ client }: Session): Promise<Outcome> {
  const removed = await client.call(UPDATE_ADDRESS_STATE, (api) => api.update.address.$delete());
  if (!removed.ok) return failed(removed.failure);

  return { ok: true, value: stateOf(removed.value), lines: ["the update link is removed"] };
}

/** Say what an update would do, with calls that only read: the newer version when one is out, and whether an update link is saved. */
async function check({ client }: Session): Promise<Outcome> {
  const who = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
  if (!who.ok) return failed(who.failure);

  const state = await client.call(UPDATE_ADDRESS_STATE, (api) => api.update.address.$get());
  if (!state.ok) return failed(state.failure);

  const { version, update } = who.value;
  const { since } = state.value;
  const lines = [
    update === undefined ? `no newer version is known; the install runs ${version}` : `${update.newest} is out; the install runs ${version}`,
    since === null ? "no update link is saved" : `an update link is saved, since ${dayText(since)}`,
    "nothing was started",
  ];

  const release = update === undefined ? null : { current: update.current, newest: update.newest, notes: update.notes };

  return { ok: true, value: { version, update: release, address: stateOf(state.value) }, lines };
}

/**
 * Run `poplin update`.
 *
 * @returns one line for a person and the install's answer for `--json`, or the problem. The address is in no line and no value
 */
export async function runUpdate(request: RequestOf<"update">, session: Session): Promise<Outcome> {
  switch (request.action) {
    case "start":
      return start(request.anyway, session);
    case "save":
      return save(session);
    case "forget":
      return forget(session);
    case "check":
      return check(session);
  }
}
