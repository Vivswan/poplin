// How a form with a token's box sends one run: the token is read from its box when the run is sent and the box is emptied at once, whatever the run answers. Nothing holds the token.

import { type RefObject, useRef, useState } from "react";

import type { DomainRun } from "@/domain/domain-queries";
import type { Refused } from "@/lib/api";
import { useOnePress } from "@/dialog/one-press";

/** The name of the token's box, and what it says when a run is asked with nothing in it. */
const TOKEN = { name: "token", empty: "Paste an account token first." } as const;

/** What is said at a box: the box's name, or `null` for a refusal about none, and the sentence. */
type Said = Pick<Refused, "about" | "message">;

/** A box beside the token's. */
interface Box {
  /** The name its value is sent under. */
  readonly name: "domain" | "login";

  /** What it says when a run is asked with nothing in it; left out for a box that may stay empty. */
  readonly empty?: string;
}

/** What a run is sent with: the token, and what the other boxes hold. */
export interface Sent {
  readonly token: string;
  readonly domain?: string;
  readonly login?: string;
}

/** A form's hold on its runs. */
interface TokenRun {
  /** The form the boxes are read from. */
  readonly sheet: RefObject<HTMLFormElement | null>;

  /** Whether a run is on its way. */
  readonly busy: boolean;

  /** The sentence to show at a box, by the box's name. */
  readonly saidAt: (name: string) => string | undefined;

  /** The sentence of a refusal about no box of this form. */
  readonly saidElsewhere: string | undefined;

  /** Send one run, unless one is on its way. A box that must be filled and is empty says so, takes the focus, and nothing is sent. */
  readonly send: (run: DomainRun) => void;

  /** Forget what was said, as a form that is opened again does. */
  readonly forget: () => void;
}

/**
 * Hold the runs of one form.
 *
 * @param boxes - the boxes beside the token's, which every form has
 * @param onRun - sends one run; it answers the refusal, or nothing when the run read its pieces
 */
export function useTokenRun(boxes: readonly Box[], onRun: (run: DomainRun, sent: Sent) => Promise<Refused | undefined>): TokenRun {
  const sheet = useRef<HTMLFormElement>(null);
  const [said, setSaid] = useState<Said>();
  const names: readonly string[] = [TOKEN.name, ...boxes.map((box) => box.name)];

  const { press: send, busy } = useOnePress(async (run: DomainRun): Promise<void> => {
    const form = sheet.current;
    if (form === null) return;

    const typed = new FormData(form);
    const text = (name: string): string => String(typed.get(name) ?? "");
    const say = (next: Said | undefined): void => {
      setSaid(next);
      if (next?.about !== null && next?.about !== undefined) (form.elements.namedItem(next.about) as HTMLInputElement | null)?.focus();
    };
    const unfilled = [...boxes, TOKEN].find((box) => box.empty !== undefined && text(box.name).trim() === "");
    if (unfilled?.empty !== undefined) {
      say({ about: unfilled.name, message: unfilled.empty });

      return;
    }

    const sent = { token: text(TOKEN.name), ...Object.fromEntries(boxes.map((box) => [box.name, text(box.name)])) };
    (form.elements.namedItem(TOKEN.name) as HTMLInputElement).value = "";
    say(await onRun(run, sent));
  });

  return {
    sheet,
    busy,
    saidAt: (name) => (said?.about === name ? said.message : undefined),
    saidElsewhere: said !== undefined && !names.includes(said.about ?? "") ? said.message : undefined,
    send,
    forget: () => setSaid(undefined),
  };
}
