// The Settings screen: one page that reads from top to bottom, every setting a block under the heading of its group, and one Save for everything that was changed, in a bar that floats over the foot of the screen while a change waits.

import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useChosenTimeZone } from "@/lib/timezone";
import { LeaveGuard } from "@/shared/leave-guard";
import { SAVE_BAR_ROOM, SaveBar } from "@/shared/save-bar";
import { type AddressDraft, useAddressDraft } from "@/settings/address-draft";
import { settingAnchor, settingOfAnchor } from "@/settings/setting-address";
import { controlId, SettingRow } from "@/settings/setting-row";
import { useDraft } from "@/settings/settings-draft";
import { type Settings, useSettings } from "@/settings/settings-queries";
import { blocksOf, UPDATES } from "@/settings/settings-words";
import { ADDRESS_FIELD, UpdateAddressRow } from "@/settings/update-address";
import { AppShell } from "@/shell/app-shell";

/** The look of a group's heading: larger than a setting's name, with clear room above it. */
const HEADING = "mt-12 text-lg leading-7 font-bold";

/** The first heading stands closer under the page's opening sentence. */
const FIRST_HEADING = "mt-7";

/** How long a block an address names stays shaded, in milliseconds. */
const MARKED_FOR = 2000;

/** The waiting changes of the settings, as the blocks need them. */
type Draft = ReturnType<typeof useDraft>;

/** The line under the heading of the settings that also change the domain's rules: those follow at the next repair. */
function RepairNote(): ReactNode {
  return (
    <p className="mt-1 text-muted-foreground">
      The rules on your domain change after Repair in{" "}
      <Link to="/domain" className="text-link underline-offset-2 hover:underline">
        Domain
      </Link>
      .
    </p>
  );
}

/** The blocks of the page: every group of settings under its heading, and the update link at the end of Updates. */
function Groups({
  settings,
  draft,
  address,
  marked,
}: {
  readonly settings: Settings;
  readonly draft: Draft;
  readonly address: AddressDraft;
  readonly marked: string | undefined;
}): ReactNode {
  return (
    <>
      {blocksOf(settings.rows).map((block, index) => (
        <section key={block.id} aria-labelledby={`block-${block.id}`}>
          <h2 id={`block-${block.id}`} className={cn(HEADING, index === 0 && FIRST_HEADING)}>
            {block.heading}
          </h2>
          {block.rows.some((row) => row.repair) ? <RepairNote /> : null}
          {block.rows.map((row) => (
            <SettingRow
              key={row.key}
              row={row}
              text={draft.shown(row)}
              refusal={draft.refusal?.key === row.key ? draft.refusal.sentence : undefined}
              onChange={(text) => draft.change(row, text)}
              marked={marked === row.key}
            />
          ))}
          {block.id === UPDATES ? <UpdateAddressRow state={settings.updateAddress} draft={address} /> : null}
        </section>
      ))}
    </>
  );
}

/** What stands in the blocks' place before they are read. */
function Waiting(): ReactNode {
  return (
    <div className="mt-12 flex flex-col gap-10" aria-busy="true">
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
function focus(id: string): void {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
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
    document.getElementById(controlId(named))?.focus({ preventScroll: true });
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
  const address = useAddressDraft();
  const count = draft.pending.length + (address.unsaved ? 1 : 0);
  const busy = draft.busy || address.busy;
  const marked = useNamedSetting(settings !== undefined);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || count === 0 || !(await draft.save())) return;

    if (!(await address.save())) focus(ADDRESS_FIELD);
  };
  const discard = (): void => {
    draft.discard();
    address.discard();
  };

  return (
    <AppShell current="settings" heading="Settings">
      <form onSubmit={(event) => void save(event)} noValidate aria-label="Settings" className="relative flex min-h-0 flex-1 flex-col border-t">
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-12 max-md:px-4", count > 0 && SAVE_BAR_ROOM)}>
          <p className="text-muted-foreground">How this install treats new sites, visitors, limits, and updates.</p>
          {error === null ? null : <p className="py-8 text-muted-foreground">{error.message}</p>}
          {settings === undefined && error === null ? <Waiting /> : null}
          {settings === undefined ? null : <Groups settings={settings} draft={draft} address={address} marked={marked} />}
        </div>
        <SaveBar count={count} busy={busy} onDiscard={discard} />
      </form>
      <LeaveGuard unsaved={count > 0} />
    </AppShell>
  );
}
