// The tabs inside one screen: a strip as the first row under the screen's title. The screen says which tab is shown and draws what it holds; the strip draws no panels.

import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** One tab of a strip. */
export interface ScreenTab<Id extends string> {
  /** The tab's key, which the screen is told when the tab is chosen. */
  readonly id: Id;

  /** The tab's words. */
  readonly label: string;

  /** What a dot beside the label says to a screen reader, such as "unsaved changes"; left out, no dot is drawn. */
  readonly mark?: string;
}

/** What a strip is drawn from. */
interface ScreenTabsProps<Id extends string> {
  /** What the tabs choose among, for a screen reader. */
  readonly label: string;

  /** The tabs, in the order shown. */
  readonly tabs: readonly ScreenTab<Id>[];

  /** The id of the tab that is shown. */
  readonly active: Id;

  /** Called with the id of a tab that was chosen. */
  readonly onChoose: (id: Id) => void;
}

/** Draw the strip of a screen's tabs. A strip wider than its room scrolls sideways. */
export function ScreenTabs<Id extends string>({ label, tabs, active, onChoose }: ScreenTabsProps<Id>): ReactNode {
  const choose = (chosen: unknown): void => {
    const tab = tabs.find((entry) => entry.id === chosen);
    if (tab !== undefined) onChoose(tab.id);
  };

  return (
    <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b px-6 max-md:px-4">
      <Tabs value={active} onValueChange={choose}>
        <TabsList aria-label={label}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="px-3">
              {tab.label}
              {tab.mark === undefined ? null : <span role="img" aria-label={tab.mark} className="size-1.5 rounded-full bg-primary" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
