// The first row of Updates on the Settings screen, which is no setting. Beside its name stands the version the install runs, and since when where it came in by an update.
// At its right, on one line: a newer version that is out, with its notes and the start of the update, and the way back to the version before. One grey line under that says what else there is to say.
// The two buttons that start something are the triggers of one question, joined to it by the dialog library's handle: the library opens the question and gives the focus back to the button. What the button asks is kept from its press.

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useOnePress } from "@/dialog/one-press";
import { api } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import { thenHome, useFocusHome } from "@/lib/focus";
import { FRAME_KEY, type Frame, GET_KEY, outWords, useFrame, useStarted } from "@/lib/frame";
import { sayDone, send } from "@/lib/notify";
import { dateIn } from "@/lib/timezone";
import { SettingFrame } from "@/settings/row/setting-frame";
import { controlId } from "@/settings/row/setting-row";
import { settingAnchor, VERSION } from "@/settings/setting-address";

/** What joins the row's one question to the two buttons that open it. */
const ASKED = AlertDialogPrimitive.createHandle();

/** What stands where the start of an update would, on an install that holds no key to send one with. */
const NO_KEY = `The install holds no key, so it cannot update itself.${GET_KEY}`;

/** How a start stands on this page: the install holds no key to send one with, one can be sent, or one was sent from this page already. */
type Standing = "no_key" | "ready" | "started";

/** What a button asks to start, as the question says it and sends it. */
interface Asked {
  /** The question itself. */
  readonly title: string;

  /** What the start does, in a sentence or two. */
  readonly says: string;

  /** The words of the button that starts it. */
  readonly yes: string;

  /** The version to take; left out for the newest release. */
  readonly to?: string;
}

/** What the row's line at the right is drawn from. */
interface OffersProps {
  /** The newer release the install knows of, or `null`. */
  readonly update: Frame["update"];

  /** The version the install can go back to, or `null`. */
  readonly back: Frame["back"];

  /** `true` where a start can be sent from this page: the two buttons are drawn only then. */
  readonly ready: boolean;

  /** Called at the press of a button that starts something, with what the button asks at that moment. */
  readonly onAsk: (asked: Asked) => void;
}

/** What the start of an update asks. An update that changes the database says that the install cannot go back from it. */
function updateAsked(update: NonNullable<Frame["update"]>): Asked {
  const says = "poplin fetches the newest release, checks it, and puts it in place of the running code. It takes a moment, and the sites stay up meanwhile.";

  return {
    title: `Update to ${update.newest}?`,
    says: update.database ? `${says} This release changes the database: after it, poplin cannot go back to ${BOOT.version}.` : says,
    yes: "Update now",
  };
}

/** What the way back to the version before asks. */
function backAsked(to: string): Asked {
  return {
    title: `Go back to ${to}?`,
    says: `poplin fetches release ${to}, checks it, and puts it in place of the running code. It takes a moment, and the sites stay up meanwhile.`,
    yes: `Go back to ${to}`,
    to,
  };
}

/**
 * Draw the row's question, once for both buttons. It stays while its answer is on its way, and takes no second press meanwhile.
 *
 * @param asked - what the button that was pressed last asked, `undefined` before the first press
 * @param notice - the line that says an update has started: once it is drawn, it takes the focus of the question that closes
 * @param onStarted - called once the install took the start
 */
function StartQuestion({ asked, notice, onStarted }: { readonly asked: Asked | undefined; readonly notice: RefObject<HTMLParagraphElement | null>; readonly onStarted: () => void }): ReactNode {
  const client = useQueryClient();
  const start = async ({ to }: Asked): Promise<void> => {
    const taken = await send(api.update.$post({ json: to === undefined ? {} : { to } }));
    // A try that was refused is a problem the frame marks, and one that was taken changes what the frame offers: either way it is read again.
    void client.invalidateQueries({ queryKey: FRAME_KEY });
    if (taken !== undefined) {
      onStarted();
      sayDone(to === undefined ? `Updated to ${taken.to}. Reload the page.` : `Went back to ${taken.to}. Reload the page.`);
    }

    // Any question open by now is about a start that was just answered: after a refusal the focus goes back to the button that asked.
    ASKED.close();
  };
  const { press, busy } = useOnePress(start);

  return (
    <AlertDialog handle={ASKED}>
      {asked === undefined ? null : (
        <AlertDialogContent finalFocus={thenHome(notice)}>
          <AlertDialogHeader>
            <AlertDialogTitle>{asked.title}</AlertDialogTitle>
            <AlertDialogDescription>{asked.says}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => press(asked)}>
              {asked.yes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}

/**
 * The row's line at the right: a newer release with its notes and the start of the update, then the way back to the version before. In a column too narrow for the line, a button goes under what stands before it.
 *
 * What an address that names the row gives the focus carries the id of the row's control: the start of the update, and the notes where there is no start.
 */
function Offers({ update, back, ready, onAsk }: OffersProps): ReactNode {
  return (
    <div data-slot="version-line" className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1.5">
      {update === null ? null : (
        <>
          {/* The sentence is as high as a control's line, so it keeps the height of the row's name where the button goes under it. */}
          <p className="py-1.5">
            {outWords(update)}.{" "}
            <a
              id={ready ? undefined : controlId(VERSION)}
              href={update.notes}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm text-link underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              What changed
            </a>
          </p>
          {ready ? (
            <AlertDialogTrigger handle={ASKED} onClick={() => onAsk(updateAsked(update))} render={<Button id={controlId(VERSION)} type="button" variant="outline" size="sm" />}>
              Update now
            </AlertDialogTrigger>
          ) : null}
        </>
      )}
      {ready && back !== null ? (
        <AlertDialogTrigger handle={ASKED} onClick={() => onAsk(backAsked(back.to))} render={<Button type="button" variant="outline" size="sm" />}>
          Go back to {back.to}
        </AlertDialogTrigger>
      ) : null}
    </div>
  );
}

/**
 * What else the row says, as one line: that the release changes the database, that the install holds no key to start an update with, and that an update has started.
 *
 * @returns the line, empty while there is nothing to say
 */
function noteOf(update: Frame["update"], standing: Standing): string {
  return [
    update?.database === true ? `This release changes the database, so it never starts by itself.${standing === "ready" ? " Press Update now." : ""}` : "",
    update !== null && standing === "no_key" ? NO_KEY : "",
    standing === "started" ? "Updated. Reload the page." : "",
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
}

/** Say how a start stands on this page. A started update is not offered again: the page runs the client it was loaded with until it is loaded again. */
function standingOf(keyed: boolean, started: boolean): Standing {
  if (started) return "started";

  return keyed ? "ready" : "no_key";
}

/**
 * Draw the row.
 *
 * @param marked - `true` while an address points the row out
 */
export function VersionRow({ marked }: { readonly marked: boolean }): ReactNode {
  const { update, starts: keyed, back } = useFrame().data;
  const [started, setStarted] = useStarted();
  // What a button asks is kept from its press. The buttons follow the frame, which is read again at any time: a question that followed its button would change its words while it is open, and its answer would send a version nobody pressed.
  const [asked, setAsked] = useState<Asked>();
  const notice = useRef<HTMLParagraphElement>(null);
  // A question a person closed before its answer came left the focus on the button that asked. That button leaves with the start: the note takes the focus then, unless a person moved it off the row meanwhile.
  const kept = useFocusHome(() => notice.current);
  const standing = standingOf(keyed, started);
  // An install that could not read its version is told of no newer release and no way back, as both come from comparing versions: its row would hold a name and nothing else.
  if (BOOT.version === "") return null;

  const ready = standing === "ready";
  // The line holds a newer release, or the way back, which is there only while it can be started.
  const offered = update !== null || (ready && back !== null);
  const note = noteOf(update, standing);

  return (
    <>
      <SettingFrame
        name="Version"
        afterName={`${BOOT.version}${back === null ? "" : `, since ${dateIn(back.since)}`}`}
        controlId={controlId(VERSION)}
        anchor={settingAnchor(VERSION)}
        marked={marked}
        says={[]}
        top
        // With nothing at its right the row is its name's line alone on a phone, as a switch's is. What stands at the right goes under the name there, and has the whole width.
        beside={!offered && note === ""}
      >
        {/* The line and the note are one column in the place of a control, so the note keeps its place when the line over it leaves, and with its place a focus it holds. */}
        <div className="flex min-w-0 flex-col gap-1.5" {...kept}>
          {offered ? <Offers update={update} back={back} ready={ready} onAsk={setAsked} /> : null}
          {note === "" ? null : (
            // Once an update has started the note takes the focus the start's button held: only then is it the question's way back, and can take a focus a script gives.
            <p data-slot="version-note" ref={started ? notice : undefined} tabIndex={started ? -1 : undefined} className="text-[13px] leading-5 text-muted-foreground outline-none">
              {note}
            </p>
          )}
        </div>
      </SettingFrame>
      <StartQuestion asked={asked} notice={notice} onStarted={setStarted} />
    </>
  );
}
