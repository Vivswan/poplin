// The panel of one problem, opened from the list on the Usage screen: its sentence, when it came and how often, what to do, the way to the screen or the setting where it is acted on, and the way to copy its details.

import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CopyDetails, ProblemTodo, ProblemWhen } from "@/problems/problem-facts";
import { HOMES } from "@/problems/problem-words";
import type { Problem } from "@/problems/problems-queries";
import { settingAddress } from "@/settings/setting-address";
import { PanelBlock, PanelLoading, SidePanel } from "@/shared/side-panel";

/** What a problem's panel is drawn from. */
interface ProblemPanelProps {
  /** The problem; `undefined` while the list is being read. */
  readonly problem: Problem | undefined;

  /** Whether the list was read, so a problem that is not there is gone and not on its way. */
  readonly read: boolean;

  /** The sentence of a list that could not be read; `undefined` while it is read or once it was. */
  readonly failure: string | undefined;

  /** The link Close is drawn as: it leads back to the list. */
  readonly closeLink: ReactElement;

  /** What Escape does: the move back to the list. */
  readonly onClose: () => void;
}

/** The way from a problem to where it is acted on: the setting of a limit, or another screen. Nothing for a problem acted on here. */
function WayThere({ problem }: { readonly problem: Problem }): ReactNode {
  if (problem.setting !== null) {
    return (
      <Button variant="outline" size="sm" nativeButton={false} render={<Link {...settingAddress(problem.setting)} />}>
        Change this limit
        <ArrowUpRightIcon data-icon="inline-end" />
      </Button>
    );
  }

  if (problem.home === "usage") return null;

  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<Link to={HOMES[problem.home].to} />}>
      Open {HOMES[problem.home].label}
      <ArrowUpRightIcon data-icon="inline-end" />
    </Button>
  );
}

/** Draw the panel of a problem. One that is no longer in the list says so, and a list that could not be read says that. */
export function ProblemPanel({ problem, read, failure, closeLink, onClose }: ProblemPanelProps): ReactNode {
  const frame = { closeLink, onClose, back: "Back to usage" };
  if (problem === undefined) {
    const says = read ? "This problem is not in the list any more." : failure;

    return (
      <SidePanel title={says === undefined ? undefined : "Problem"} {...frame}>
        {says === undefined ? <PanelLoading /> : <p className="px-6 text-muted-foreground max-md:px-4">{says}</p>}
      </SidePanel>
    );
  }

  return (
    <SidePanel title={problem.sentence} {...frame}>
      <PanelBlock>
        <p>
          <ProblemWhen problem={problem} />
        </p>
      </PanelBlock>
      <PanelBlock label="What to do">
        <p>
          <ProblemTodo problem={problem} />
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <WayThere problem={problem} />
          <CopyDetails problem={problem} />
        </div>
      </PanelBlock>
    </SidePanel>
  );
}
