// The Settings screen: one page that reads from top to bottom, every setting a row under the heading of its group, and one Save for everything that was changed, in a bar under the page while a change waits.

import { Link, useLocation } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useFocusHome } from "@/lib/focus";
import { GET_KEY, useFrame } from "@/lib/frame";
import { useChosenTimeZone } from "@/lib/timezone";
import { HomeProblems } from "@/problems/home-problems";
import { LeaveGuard } from "@/shared/leave-guard";
import { MiddleColumn } from "@/shared/middle-column";
import { SaveBar } from "@/shared/save-bar";
import { settingAnchor, settingOfAnchor } from "@/settings/setting-address";
import { controlId, SettingRow } from "@/settings/setting-row";
import { boundedBy, isOn } from "@/settings/setting-values";
import { useDraft } from "@/settings/settings-draft";
import { type Row, type Settings, useSettings } from "@/settings/settings-queries";
import { type Block, blocksOf, UPDATES, wordsOf } from "@/settings/settings-words";
import { AppShell } from "@/shell/app-shell";

/** A group: its heading over its rows, and a line between it and the group before. */
const GROUP = "mt-5 border-t pt-5 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0";

/** The look of a group's heading: as large as the screen's title and no larger, and larger than a setting's name. */
const HEADING = "mb-1 text-base leading-6 font-bold";

/** The setting that starts updates by itself, and what its row says while the install holds no key: the switch then starts nothing. */
const [AUTO_UPDATE, NEEDS_KEY] = ["auto_update", `Needs poplin's key to work.${GET_KEY}`] as const;

/** How long a block an address names stays shaded, in milliseconds. */
const MARKED_FOR = 2000;

/** The waiting changes of the settings, as the blocks need them. */
type Draft = ReturnType<typeof useDraft>;

/** What the line says changes after a repair: the rules, where every setting of the block waits for one, and else the waiting settings by their names. The others reach the domain by themselves. */
function waitingWords(block: Block): string {
  const waiting = block.rows.filter((row) => row.repair).map((row) => wordsOf(row.key).label);
  if (waiting.length === block.rows.length) return "The rules on your domain change";

  return `${new Intl.ListFormat("en").format(waiting)} ${waiting.length === 1 ? "changes" : "change"} on your domain`;
}

/** The line under the heading of a block with settings whose half on the domain waits for the next repair. */
function RepairNote({ block }: { readonly block: Block }): ReactNode {
  return (
    <p className="mb-1 text-muted-foreground">
      {waitingWords(block)} after Repair in{" "}
      <Link to="/domain" className="text-link underline-offset-2 hover:underline">
        Domain
      </Link>
      .
    </p>
  );
}

/** The blocks of the page: every group of settings under its heading. */
function Groups({
  settings,
  draft,
  keyed,
  marked,
}: {
  readonly settings: Settings;
  readonly draft: Draft;
  readonly keyed: boolean;
  readonly marked: string | undefined;
}): ReactNode {
  return (
    <>
      {blocksOf(settings.rows).map((block) => (
        <section key={block.id} aria-label={block.heading} className={GROUP}>
          <h2 className={HEADING}>{block.heading}</h2>
          {block.rows.some((row) => row.repair) ? <RepairNote block={block} /> : null}
          {block.id === UPDATES ? <HomeProblems home="settings" className="flex flex-col gap-2 pb-2" /> : null}
          {block.rows.map((row) => (
            <SettingRow
              key={row.key}
              row={waitingOn(boundedBy(row, settings.rows, draft.shown), settings.rows, draft)}
              text={draft.shown(row)}
              refusal={draft.refusals[row.key]}
              onChange={(text) => draft.change(row, text)}
              marked={marked === row.key}
              note={row.key === AUTO_UPDATE && !keyed ? NEEDS_KEY : undefined}
            />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * A switch as it is drawn while the switch it needs is off, saved or not: it says what to switch on first, and takes no change.
 *
 * @returns the row itself for every other setting, and while the switch it needs is on
 */
function waitingOn(row: Row, rows: readonly Row[], draft: Draft): Row {
  const { needs, needsLine } = wordsOf(row.key);
  const needed = rows.find((other) => other.key === needs);
  if (needed === undefined || needsLine === undefined || isOn(needed, draft.shown(needed))) return row;

  return { ...row, needs: row.needs ?? needsLine };
}

/** What stands in the blocks' place before they are read. */
function Waiting(): ReactNode {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      {[0, 1, 2].map((block) => (
        <div key={block} className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-8 w-48" />
        </div>
      ))}
    </div>
  );
}

/** Give a control the focus once the page has drawn what a save's answer changed; the page scrolls to it. */
function focus(id: string, options?: FocusOptions): void {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus(options));
}

/**
 * Point out the setting the address names, once its block is drawn: the block comes into view, its control takes the focus, and the block is shaded for a moment.
 *
 * @param drawn - whether the blocks are on the page
 * @returns the key of the setting that is pointed out now; none before and after
 */
function useNamedSetting(drawn: boolean): string | undefined {
  const named = useLocation({ select: (location) => settingOfAnchor(location.hash) });
  const [marked, setMarked] = useState<string>();

  useEffect(() => {
    const block = named === undefined || !drawn ? null : document.getElementById(settingAnchor(named));
    if (named === undefined || block === null) return undefined;

    block.scrollIntoView({ block: "center" });
    focus(controlId(named), { preventScroll: true });
    setMarked(named);
    const done = window.setTimeout(() => setMarked(undefined), MARKED_FOR);

    return () => window.clearTimeout(done);
  }, [named, drawn]);

  return marked;
}

/** Draw the Settings screen. */
export function SettingsScreen(): ReactNode {
  useChosenTimeZone();
  const { data: settings, error } = useSettings();
  // A refused setting may be out of sight: its field takes the focus.
  const draft = useDraft(settings?.rows ?? [], (key) => focus(controlId(key)));
  const keyed = useFrame().data.starts;
  const count = draft.pending.length;
  const { busy } = draft;
  const marked = useNamedSetting(settings !== undefined);
  // Save and Discard leave with their bar, and the focus with them: it goes back to the control of the page that had it last.
  const last = useRef<HTMLElement | null>(null);
  const kept = useFocusHome(() => last.current);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || count === 0) return;

    await draft.save();
  };

  return (
    <AppShell current="settings" heading="Settings">
      <form onSubmit={(event) => void save(event)} noValidate aria-label="Settings" className="flex min-h-0 flex-1 flex-col" {...kept}>
        <div
          onFocusCapture={(event) => {
            last.current = event.target;
          }}
          className="line-room relative min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-12 [scrollbar-gutter:stable] max-md:px-4"
        >
          <MiddleColumn>
            <p className="mb-5 text-muted-foreground">How this install treats new sites, visitors, limits, and updates.</p>
            {error === null ? null : <p className="py-8 text-muted-foreground">{error.message}</p>}
            {settings === undefined && error === null ? <Waiting /> : null}
            {settings === undefined ? null : <Groups settings={settings} draft={draft} keyed={keyed} marked={marked} />}
          </MiddleColumn>
        </div>
        <SaveBar count={count} busy={busy} onDiscard={draft.discard} />
      </form>
      <LeaveGuard unsaved={count > 0} />
    </AppShell>
  );
}
