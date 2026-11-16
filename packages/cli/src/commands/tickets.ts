// The tickets of one upload as its lanes share them: the ones the install handed out as the upload began, and more asked for as the files go.
//
//   a ticket is refused where it points          a fresh ticket is asked for that file, once
//   the fresh ticket is refused too              every ticket is dropped, and from then on the install is asked for tickets of its own route
//   a ticket of the install's own route refused  the refusal stands

import { TICKETS_PER_CALL, type Ticket } from "../../../core/src/storage/tickets";
import type { Called, Failure } from "../client/client";

/** The status of an answer that was done, for the failure of a done answer that holds no ticket for the file it was asked about. */
const OK = 200;

/** Asks the install for the tickets of some files of the upload, by their paths; with `through`, for tickets of the install's own route. */
type Ask = (paths: readonly string[], through: boolean) => Promise<Called<readonly Ticket[]>>;

/**
 * The tickets of one upload. A file's ticket is the one held for it; a file with none has the install asked for it, together with the tickets of the files that go after it, up to a hundred a call.
 * A ticket is held for the whole upload, and a file that is sent again goes by the same one. The moment a ticket names is not read against this computer's clock: whoever takes the file decides whether its ticket still holds.
 *
 * One call is on its way at a time: a lane that needs a ticket while another lane asks waits for that answer first.
 */
export class TicketBook {
  readonly #ask: Ask;

  readonly #turned: () => void;

  readonly #held = new Map<string, Ticket>();

  readonly #renewed = new Set<string>();

  #waiting = new Set<string>();

  #asking: Promise<Failure | undefined> | undefined;

  #through = false;

  /**
   * @param first - the tickets the install handed out as the upload began, when it did
   * @param turned - called once, when the upload turns to the install's own route
   */
  constructor(first: readonly Ticket[] | undefined, ask: Ask, turned: () => void = () => undefined) {
    this.#ask = ask;
    this.#turned = turned;

    for (const ticket of first ?? []) this.#held.set(ticket.path, ticket);
  }

  async #more(path: string): Promise<Failure | undefined> {
    const paths = [path];

    for (const next of this.#waiting) {
      if (paths.length === TICKETS_PER_CALL) break;

      if (next !== path && !this.#held.has(next)) paths.push(next);
    }

    const through = this.#through;
    const asked = await this.#ask(paths, through);
    if (!asked.ok) return asked.failure;

    // An answer from before the upload turned to the install's route holds tickets that are refused: it is dropped, and asked for again.
    if (through !== this.#through) return undefined;

    // Only a ticket that was asked for is kept: an answer names no other file's place.
    const named = new Set(paths);
    for (const ticket of asked.value) if (named.has(ticket.path)) this.#held.set(ticket.path, ticket);

    return undefined;
  }

  /**
   * Name the files that are about to be sent, in the order they go: a call for one file's ticket asks for the tickets of the next ones too.
   *
   * @param paths - each as the upload declared it
   */
  expect(paths: readonly string[]): void {
    this.#waiting = new Set(paths);
  }

  /** Take a file that arrived out of the ones to send, so no call asks for its ticket beside another file's. Its ticket is kept: a file the install lacks after all is sent again by it. */
  arrived(path: string): void {
    this.#waiting.delete(path);
  }

  /**
   * Take a ticket that was refused where it points out of the ones held, so the file's next sending goes by another.
   *
   * @param ticket - the ticket the file was sent by
   * @returns whether another ticket is worth asking for: not for a ticket of the install's own route, which the install answers the same again
   */
  refused(ticket: Ticket): boolean {
    // Another lane has dropped it already: the file's next ticket is a new one.
    if (this.#held.get(ticket.path) !== ticket) return true;

    if (this.#through) return false;

    this.#held.delete(ticket.path);
    if (!this.#renewed.has(ticket.path)) {
      this.#renewed.add(ticket.path);

      return true;
    }

    this.#through = true;
    this.#held.clear();
    this.#turned();

    return true;
  }

  /**
   * Find the ticket one file is sent by.
   *
   * @returns the ticket, or why there is none: the failure of the call that asked for it, or `unexpected` for an answer that holds no ticket for the file
   */
  async of(path: string): Promise<Called<Ticket>> {
    // Which kind of ticket this call last asked for: none yet, or one of the install's own route or not.
    let asked: boolean | undefined;

    for (;;) {
      const ticket = this.#held.get(path);
      if (ticket !== undefined) return { ok: true, value: ticket };

      if (this.#asking === undefined) {
        if (asked === this.#through) return { ok: false, failure: { kind: "unexpected", status: OK } };

        asked = this.#through;
        this.#asking = this.#more(path).finally(() => {
          this.#asking = undefined;
        });
      }

      const failure = await this.#asking;
      if (failure !== undefined) return { ok: false, failure };
    }
  }
}
