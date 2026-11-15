// The Settings screen: one page, every setting one line under the heading of its block, and one Save for everything that was changed, in a bar that floats over the foot of the screen while a change waits.

import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { send } from "@/lib/notify";
import { Confirm } from "@/shared/confirm";
import { LeaveGuard } from "@/shared/leave-guard";
import { SAVE_BAR_ROOM, SaveBar } from "@/shared/save-bar";
import { type AddressDraft, useAddressDraft } from "@/settings/address-draft";
import { ROW_LOOK } from "@/settings/row-line";
import { settingAnchor, settingOfAnchor } from "@/settings/setting-address";
import { controlId, SettingRow } from "@/settings/setting-row";
import { useDraft } from "@/settings/settings-draft";
import { type Settings, useSettings } from "@/settings/settings-queries";
import { blocksOf, UPDATES } from "@/settings/settings-words";
import { ADDRESS_FIELD, UpdateAddressRow } from "@/settings/update-address";
import { AppShell } from "@/shell/app-shell";

/** The look of a block's heading: small and quiet, across the page, with room above it that sets the blocks apart. */
const HEADING = "border-b px-6 pt-8 pb-2 text-xs font-medium text-muted-foreground max-md:px-4";

/** How long a line an address names stays shaded, in milliseconds. */
const MARKED_FOR = 2000;

/** The question before every session is ended. */
const SIGN_OUT = {
  title: "Sign everyone out?",
  says: "Every browser logged in to this dashboard, this one included, has to log in again.",
  yes: "Sign everyone out",
  removes: true,
} as const;

/** The waiting changes of the settings, as the rows need them. */
type Draft = ReturnType<typeof useDraft>;

/** The line over the settings that also change the domain's rules: what a change does at once, and what waits for a repair. */
function RepairNote(): ReactNode {
  return (
    <p className="border-b px-6 py-2.5 text-[13px] text-muted-foreground max-md:px-4">
      Applies to your sites at once. For your domain, press Repair in{" "}
      <Link to="/domain" className="text-link underline-offset-2 hover:underline">
        Domain
      </Link>
      .
    </p>
  );
}

/** The last block of the page: the button that ends every session, behind a question. */
function Sessions(): ReactNode {
  const [asking, setAsking] = useState(false);

  const signOut = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const done = await send(api.settings["sign-everyone-out"].$post({ json: {} }));
    // This session ended too: the page is asked for again, which leads to the login.
    if (done !== undefined) window.location.reload();
  };

  return (
    <section aria-labelledby="sessions">
      <h2 id="sessions" className={HEADING}>
        Sessions
      </h2>
      <div className={cn(ROW_LOOK, "items-center")}>
        <p>Every browser logs in again</p>
        <div>
          <Button type="button" variant="destructive" onClick={() => setAsking(true)}>
            Sign everyone out
          </Button>
        </div>
      </div>
      <Confirm question={asking ? SIGN_OUT : undefined} onAnswer={(yes) => void signOut(yes)} />
    </section>
  );
}

/** The lines of the page: every block of settings under its heading, the rebuild address at the end of Updates, and the sign-out last. */
function Rows({
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
    <div className="pb-8">
      {blocksOf(settings.rows).map((block, index) => (
        <section key={block.id} aria-labelledby={`block-${block.id}`}>
          <h2 id={`block-${block.id}`} className={cn(HEADING, index === 0 && "pt-5")}>
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
      <Sessions />
    </div>
  );
}

/** What stands in the rows' place before they are read. */
function Waiting(): ReactNode {
  return (
    <div className="flex flex-col pt-5" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-12 items-center border-b px-6 max-md:px-4">
          <Skeleton className="h-4 w-full max-w-3xl" />
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
 * Point out the setting the address names, once its line is drawn: the line comes into view, its control takes the focus, and the line is shaded for a moment.
 *
 * @param drawn - whether the rows are on the page
 * @returns the key of the setting that is pointed out now; none before and after
 */
function useNamedSetting(drawn: boolean): string | undefined {
  const named = useLocation({ select: (location) => settingOfAnchor(location.hash) });
  const [marked, setMarked] = useState<string>();

  useEffect(() => {
    const line = named === undefined || !drawn ? null : document.getElementById(settingAnchor(named));
    if (named === undefined || line === null) return undefined;

    line.scrollIntoView({ block: "center" });
    document.getElementById(controlId(named))?.focus({ preventScroll: true });
    setMarked(named);
    const done = window.setTimeout(() => setMarked(undefined), MARKED_FOR);

    return () => window.clearTimeout(done);
  }, [named, drawn]);

  return marked;
}

/** Draw the Settings screen. */
export function SettingsScreen(): ReactNode {
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
        <div className={cn("min-h-0 flex-1 overflow-y-auto", count > 0 && SAVE_BAR_ROOM)}>
          {error === null ? null : <p className="px-6 py-8 text-muted-foreground max-md:px-4">{error.message}</p>}
          {settings === undefined && error === null ? <Waiting /> : null}
          {settings === undefined ? null : <Rows settings={settings} draft={draft} address={address} marked={marked} />}
        </div>
        <SaveBar count={count} busy={busy} onDiscard={discard} />
      </form>
      <LeaveGuard unsaved={count > 0} />
    </AppShell>
  );
}
