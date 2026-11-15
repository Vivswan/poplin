// The Settings screen: every setting of the install as one row across the working area, in groups that each save by themselves, and the sign-out of every browser at the end.

import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { type ReactNode, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { send } from "@/lib/notify";
import { Confirm } from "@/shared/confirm";
import { LeaveGuard } from "@/shared/leave-guard";
import { ROW_GRID } from "@/settings/row-frame";
import { SettingGroup } from "@/settings/setting-group";
import { useSettings } from "@/settings/settings-queries";
import { groupsOf } from "@/settings/settings-words";
import { UpdateAddressRow } from "@/settings/update-address";
import { AppShell } from "@/shell/app-shell";

/** What the rebuild address goes by among the things of the screen that can hold unsaved typing; the groups go by their ids. */
const ADDRESS = "update-address";

/** The question before every session is ended. */
const SIGN_OUT = {
  title: "Sign everyone out?",
  says: "Every browser logged in to this dashboard, this one included, has to log in again.",
  yes: "Sign everyone out",
  removes: true,
} as const;

/** The headings above the rows, on the rows' own cells. */
function Headings(): ReactNode {
  return (
    <div className={cn(ROW_GRID, "sticky top-0 z-10 h-9 items-center border-b bg-background text-xs text-muted-foreground max-md:hidden")} aria-hidden="true">
      <span>Setting</span>
      <span>Value</span>
      <span>Default</span>
      <span>State</span>
    </div>
  );
}

/** What the last group says under its heading: why its settings are only read here, and the way to where they are changed. */
function DomainSays(): ReactNode {
  return (
    <>
      These also change rules on your domain, so they are changed{" "}
      <Link to="/domain" className="text-link underline-offset-2 hover:underline">
        where the domain is set up
      </Link>
      .
    </>
  );
}

/** The last thing on the screen: the button that ends every session, behind a question. */
function SignEveryoneOut(): ReactNode {
  const [asking, setAsking] = useState(false);

  const signOut = async (yes: boolean): Promise<void> => {
    setAsking(false);
    if (!yes) return;

    const done = await send(api.settings["sign-everyone-out"].$post({ json: {} }));
    // This session ended too: the page is asked for again, which leads to the login.
    if (done !== undefined) window.location.reload();
  };

  return (
    <section aria-labelledby="sign-everyone-out" className={cn(ROW_GRID, "items-start py-5")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="sign-everyone-out" className="text-sm font-bold">
          Sign everyone out
        </h2>
        <p className="max-w-[60ch] text-[13px] text-muted-foreground">
          Every browser logged in to this dashboard, this one included, has to log in again. Private sites keep their own login, and tokens and site links stay
          as they are.
        </p>
      </div>
      <div>
        <Button variant="destructive" onClick={() => setAsking(true)}>
          Sign everyone out
        </Button>
      </div>
      <Confirm question={asking ? SIGN_OUT : undefined} onAnswer={(yes) => void signOut(yes)} />
    </section>
  );
}

/** Draw the Settings screen. */
export function SettingsScreen(): ReactNode {
  const { data: settings, error } = useSettings();
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const onUnsaved = useCallback((id: string, holds: boolean): void => {
    setUnsaved((ids) => (ids.includes(id) === holds ? ids : [...ids.filter((kept) => kept !== id), ...(holds ? [id] : [])]));
  }, []);
  const onAddress = useCallback((holds: boolean): void => onUnsaved(ADDRESS, holds), [onUnsaved]);

  return (
    <AppShell current="settings" heading="Settings">
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        {error === null ? null : <p className="px-6 py-8 text-muted-foreground max-md:px-4">{error.message}</p>}
        {settings === undefined && error === null ? (
          <div className="flex flex-col" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="flex h-16 items-center border-b px-6 max-md:px-4">
                <Skeleton className="h-4 w-full max-w-3xl" />
              </div>
            ))}
          </div>
        ) : null}
        {settings === undefined ? null : (
          <>
            <Headings />
            {groupsOf(settings.rows).map((group) => (
              <SettingGroup key={group.id} group={group} says={group.id === "domain" ? <DomainSays /> : undefined} onUnsaved={onUnsaved}>
                {group.id === "updates" ? <UpdateAddressRow state={settings.updateAddress} onUnsaved={onAddress} /> : null}
              </SettingGroup>
            ))}
            <SignEveryoneOut />
          </>
        )}
      </div>
      <LeaveGuard unsaved={unsaved.length > 0} />
    </AppShell>
  );
}
