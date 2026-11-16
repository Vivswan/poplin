// The Usage screen: the visits over time, then what the install holds and has answered today, each number beside its limit.

import type { ReactNode } from "react";

import { WaitingRows } from "@/shared/waiting-rows";
import { AppShell } from "@/shell/app-shell";
import { useUsage } from "@/usage/usage-queries";
import { UsageTable } from "@/usage/usage-table";
import { VisitsBlock } from "@/usage/visits-block";

/** Draw the Usage screen. */
export function UsageScreen(): ReactNode {
  const { data: usage, error } = useUsage();

  return (
    <AppShell current="usage" heading="Usage">
      <section aria-label="Usage" className="line-room flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <VisitsBlock />
        {error === null ? null : <p className="px-6 py-8 text-muted-foreground max-md:px-4">{error.message}</p>}
        {usage === undefined && error === null ? <WaitingRows /> : null}
        {usage === undefined ? null : <UsageTable usage={usage} />}
      </section>
    </AppShell>
  );
}
