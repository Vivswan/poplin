// The first row of Updates on the Settings screen, which is no setting: the version the install runs, and since when where it came in by an update, with the way back to the version before.
// While a newer version is out, the row also holds its notes and the start of the update.
// The two buttons that start something are the triggers of one question, joined to it by the dialog library's handle: the library opens the question with what the button asks, and gives the focus back to the button.

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

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
import { thenHome } from "@/lib/focus";
import { FRAME_KEY, type Frame, GET_KEY, outWords, useFrame, useStarted } from "@/lib/frame";
import { sayDone, send } from "@/lib/notify";
import { dateIn } from "@/lib/timezone";
import { SettingFrame } from "@/settings/row/setting-frame";
import { controlId } from "@/settings/row/setting-row";
import { settingAnchor, VERSION } from "@/settings/setting-address";

/** What joins the row's one question to the two buttons that ask it. */
const ASKED = AlertDialogPrimitive.createHandle<Asked>();

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

/** What the row shows under the version. */
interface UnderVersionProps {
  /** The newer release the install knows of, or `null`. */
  readonly update: Frame["update"];

  /** The way back to the version before, where it can be started from this page; `null` otherwise. */
  readonly wayBack: Frame["back"];

  /** How a start stands on this page. */
  readonly standing: Standing;

  /** The reference of the line that says an update has started. */
  readonly notice: RefObject<HTMLParagraphElement | null>;
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
 * The reference of the line that says an update has started.
 *
 * A question a person closed before its answer came left the focus on the button that asked. That button leaves with the start, so the focus drops to the page: the line takes it.
 */
function useNotice(started: boolean): RefObject<HTMLParagraphElement | null> {
  const notice = useRef<HTMLParagraphElement>(null);
  const before = useRef(started);

  useEffect(() => {
    if (started && !before.current && document.activeElement === document.body) notice.current?.focus();

    before.current = started;
  }, [started]);

  return notice;
}

/**
 * Draw the row's question, once for both buttons. It stays while its answer is on its way, and takes no second press meanwhile.
 *
 * @param notice - the line that says an update has started: once it is drawn, it takes the focus of the question that closes
 * @param onStarted - called once the install took the start
 */
function StartQuestion({ notice, onStarted }: { readonly notice: RefObject<HTMLParagraphElement | null>; readonly onStarted: () => void }): ReactNode {
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
      {({ payload: asked }) =>
        asked === undefined ? null : (
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
        )
      }
    </AlertDialog>
  );
}

/**
 * The lines under the version, drawn while there is one: the way back to the version before; a newer release with its notes, what keeps it from starting, and its start; and that an update has started.
 *
 * What an address that names the row gives the focus carries the id of the row's control: the start of the update, and the notes where there is no start.
 */
function UnderVersion({ update, wayBack, standing, notice }: UnderVersionProps): ReactNode {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {wayBack === null ? null : (
        <AlertDialogTrigger handle={ASKED} payload={backAsked(wayBack.to)} render={<Button type="button" variant="outline" size="sm" />}>
          Go back to {wayBack.to}
        </AlertDialogTrigger>
      )}
      {update === null ? null : (
        <>
          <p className="text-foreground">
            {outWords(update)}.{" "}
            <a
              id={standing === "ready" ? undefined : controlId(VERSION)}
              href={update.notes}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm text-link underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              What changed
            </a>
          </p>
          {update.database ? <p className="text-muted-foreground">This release changes the database, so it never starts by itself.{standing === "ready" ? " Press Update now." : ""}</p> : null}
          {standing === "no_key" ? <p className="text-muted-foreground">{NO_KEY}</p> : null}
          {standing === "ready" ? (
            <AlertDialogTrigger handle={ASKED} payload={updateAsked(update)} render={<Button id={controlId(VERSION)} type="button" variant="outline" size="sm" />}>
              Update now
            </AlertDialogTrigger>
          ) : null}
        </>
      )}
      {standing === "started" ? (
        <p ref={notice} tabIndex={-1} className="text-muted-foreground outline-none">
          Updated. Reload the page.
        </p>
      ) : null}
    </div>
  );
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
  const notice = useNotice(started);
  const standing = standingOf(keyed, started);
  // An install that could not read its version is told of no newer release and no way back, as both come from comparing versions: its row would hold a name and nothing else.
  if (BOOT.version === "") return null;

  const wayBack = standing === "ready" ? back : null;
  // With nothing under it the version stays beside its name on a phone, as a switch does. With lines under it, it goes under its name, as a field does, and the lines have the whole width.
  const lined = wayBack !== null || update !== null || started;

  return (
    <>
      <SettingFrame
        name="Version"
        controlId={controlId(VERSION)}
        anchor={settingAnchor(VERSION)}
        marked={marked}
        says={[]}
        top
        beside={!lined}
        under={lined ? <UnderVersion update={update} wayBack={wayBack} standing={standing} notice={notice} /> : undefined}
      >
        {/* The version starts where its name does: a text's line is lower than a control's, which the frame sets the name's height by. */}
        <p className="leading-6 @[480px]:self-start">
          {BOOT.version}
          {back === null ? "" : `, since ${dateIn(back.since)}`}
        </p>
      </SettingFrame>
      <StartQuestion notice={notice} onStarted={setStarted} />
    </>
  );
}
