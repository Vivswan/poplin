// The Settings screen: four short tabs of settings, each setting one line, and one Save for everything that was changed, in a bar that floats over the foot of the screen while a change waits.

import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAddressQuery } from "@/lib/address";
import { api } from "@/lib/api";
import { send } from "@/lib/notify";
import { Confirm } from "@/shared/confirm";
import { LeaveGuard } from "@/shared/leave-guard";
import { SAVE_BAR_ROOM, SaveBar } from "@/shared/save-bar";
import { type ScreenTab, ScreenTabs } from "@/shared/screen-tabs";
import { type AddressDraft, useAddressDraft } from "@/settings/address-draft";
import { controlId, SettingRow } from "@/settings/setting-row";
import { useDraft } from "@/settings/settings-draft";
import { type Row, type Settings, useSettings } from "@/settings/settings-queries";
import { blocksOf, TABS, type TabId, tabOf } from "@/settings/settings-words";
import { ADDRESS_FIELD, UpdateAddressRow } from "@/settings/update-address";
import { AppShell } from "@/shell/app-shell";

/** The screen's own path. */
const PATH = "/settings";

/** The key of the address's query that names the tab; the first tab needs none. */
const TAB_KEY = "tab";

/** The tab that also holds the rebuild address and the sign-out. */
const UPDATES: TabId = "updates";

/** The question before every session is ended. */
const SIGN_OUT = {
  title: "Sign everyone out?",
  says: "Every browser logged in to this dashboard, this one included, has to log in again.",
  yes: "Sign everyone out",
  removes: true,
} as const;

/** The waiting changes of the settings, as the tab's rows need them. */
type Draft = ReturnType<typeof useDraft>;

/** The line over the settings that also change the domain's rules: what a change does at once, and what waits for a repair. */
function RepairNote(): ReactNode {
  return (
    <p className="border-b py-3 text-[13px] text-muted-foreground">
      Changes here apply to your sites at once. To apply them to your domain too, open{" "}
      <Link to="/domain" className="text-link underline-offset-2 hover:underline">
        Domain
      </Link>{" "}
      and press Repair.
    </p>
  );
}

/** The last thing of the Updates tab: the button that ends every session, behind a question. */
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
      <h2 id="sessions" className="pt-6 pb-1 text-xs font-medium text-muted-foreground">
        Sessions
      </h2>
      <div className="grid items-center gap-x-6 gap-y-1.5 border-b py-2 md:grid-cols-[minmax(0,1fr)_17rem]">
        <p>Every browser has to log in again, this one included</p>
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

/** The lines of one tab: its blocks of settings, each under its heading where the tab has more than one, and on the Updates tab the rebuild address and the sign-out. */
function TabRows({ tab, settings, draft, address }: { readonly tab: TabId; readonly settings: Settings; readonly draft: Draft; readonly address: AddressDraft }): ReactNode {
  const blocks = blocksOf(tab, settings.rows);

  return (
    <div className="max-w-3xl px-6 pt-1 pb-6 max-md:px-4">
      {blocks.some((block) => block.rows.some((row) => row.repair)) ? <RepairNote /> : null}
      {blocks.map((block) => (
        <section key={block.id} aria-labelledby={block.heading === "" ? undefined : `block-${block.id}`}>
          {block.heading === "" ? null : (
            <h2 id={`block-${block.id}`} className="pt-6 pb-1 text-xs font-medium text-muted-foreground first:pt-4">
              {block.heading}
            </h2>
          )}
          {block.rows.map((row) => (
            <SettingRow
              key={row.key}
              row={row}
              text={draft.shown(row)}
              refusal={draft.refusal?.key === row.key ? draft.refusal.sentence : undefined}
              onChange={(text) => draft.change(row, text)}
            />
          ))}
        </section>
      ))}
      {tab === UPDATES ? <UpdateAddressRow state={settings.updateAddress} draft={address} /> : null}
      {tab === UPDATES ? <Sessions /> : null}
    </div>
  );
}

/** What stands in the rows' place before they are read. */
function Waiting(): ReactNode {
  return (
    <div className="flex max-w-3xl flex-col px-6 max-md:px-4" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-12 items-center border-b">
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

/** The tabs that hold a waiting change: the ones of the changed rows, and the address's own. */
function changedTabs(pending: readonly Row[], address: AddressDraft): readonly TabId[] {
  const tabs = pending.flatMap((row) => tabOf(row.key) ?? []);

  return address.unsaved ? [...tabs, UPDATES] : tabs;
}

/** Draw the Settings screen. */
export function SettingsScreen(): ReactNode {
  const { data: settings, error } = useSettings();
  const navigate = useNavigate();
  const named = useAddressQuery().get(TAB_KEY);
  const tab = TABS.find((entry) => entry.id === named)?.id ?? TABS[0].id;
  const show = (next: TabId): void => void navigate({ to: PATH, search: next === TABS[0].id ? {} : { [TAB_KEY]: next }, replace: true });
  const focus = (id: string): void => void window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(id)?.focus()));

  // A refused setting may sit in another tab than the one shown: its tab is shown, and its field takes the focus.
  const draft = useDraft(settings?.rows ?? [], (key) => {
    show(tabOf(key) ?? tab);
    focus(controlId(key));
  });
  const address = useAddressDraft();
  const count = draft.pending.length + (address.unsaved ? 1 : 0);
  const busy = draft.busy || address.busy;
  const changed = changedTabs(draft.pending, address);
  const tabs: readonly ScreenTab<TabId>[] = TABS.map(({ id, label }) => (changed.includes(id) ? { id, label, mark: "unsaved changes" } : { id, label }));

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || count === 0 || !(await draft.save())) return;

    if (await address.save()) return;

    show(UPDATES);
    focus(ADDRESS_FIELD);
  };
  const discard = (): void => {
    draft.discard();
    address.discard();
  };

  return (
    <AppShell current="settings" heading="Settings">
      <form onSubmit={(event) => void save(event)} noValidate aria-label="Settings" className="relative flex min-h-0 flex-1 flex-col border-t">
        <ScreenTabs label="Kinds of settings" tabs={tabs} active={tab} onChoose={show} />
        <div className={cn("min-h-0 flex-1 overflow-y-auto", count > 0 && SAVE_BAR_ROOM)}>
          {error === null ? null : <p className="px-6 py-8 text-muted-foreground max-md:px-4">{error.message}</p>}
          {settings === undefined && error === null ? <Waiting /> : null}
          {settings === undefined ? null : <TabRows tab={tab} settings={settings} draft={draft} address={address} />}
        </div>
        <SaveBar count={count} busy={busy} onDiscard={discard} />
      </form>
      <LeaveGuard unsaved={count > 0} />
    </AppShell>
  );
}
