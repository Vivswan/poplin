// `poplin update`: ask the install to take the newest release, or the one version `--to` names, and put it in place of its running code, or say what a start would come to.

import { STARTED_UPDATE } from "../../../core/src/actions/start-update";
import { UPDATE_STATE } from "../../../core/src/actions/update";
import { problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";

/** What the check says of an install by whether it holds its key. */
const KEY_LINES = {
  held: "the install holds its key",
  none: "the install holds no key, so it cannot update itself: open Domain on the dashboard and press Repair",
} as const;

async function start({ client }: Session, asked: string | undefined): Promise<Outcome> {
  // The install answers once the release is in place, which takes longer than a call that only reads or writes a row.
  const started = await client.call(STARTED_UPDATE, (api) => api.update.$post({ query: asked === undefined ? {} : { to: asked } }), "long");
  if (!started.ok) return { ok: false, problem: problemOf(started.failure) };

  const { from, to } = started.value;

  return { ok: true, value: { started: true, from, to }, lines: [{ tone: "done", text: `the install now runs ${to}; it ran ${from}` }] };
}

/** Say what a start would come to, with one call that only reads: the newer version when one is out, whether the install holds the key an update is sent with, and the version it can go back to. */
async function check({ client }: Session): Promise<Outcome> {
  const state = await client.call(UPDATE_STATE, (api) => api.update.$get({ query: {} }));
  if (!state.ok) return { ok: false, problem: problemOf(state.failure) };

  const { version, update, key, back } = state.value;
  const lines = [
    update === null ? `no newer version is known; the install runs ${version}` : `${update.newest} is out; the install runs ${version}`,
    key ? KEY_LINES.held : KEY_LINES.none,
    ...(back === null ? [] : [`the install can go back to ${back.to}: poplin update --to ${back.to}`]),
    "nothing was started",
  ];

  const release = update === null ? null : { current: update.current, newest: update.newest, notes: update.notes };

  return { ok: true, value: { version, update: release, key, back: back === null ? null : back.to }, lines };
}

/**
 * Run `poplin update`.
 *
 * @returns one line for a person and the install's answer for `--json`, or the problem
 */
export async function runUpdate(request: RequestOf<"update">, session: Session): Promise<Outcome> {
  return request.action.kind === "check" ? check(session) : start(session, request.action.to);
}
