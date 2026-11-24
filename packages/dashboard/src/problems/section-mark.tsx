// A section of the side with its mark, the one sign that shows on every screen. A warning sign where the section's screen holds a problem, with how many as its name and the first one's sentence as the link's hint.
// At Settings, while its screen holds no problem and a newer release is out, a quieter sign that leads to the row where the update starts. A pointer and the keyboard are shown the hint alike.
// On a phone the sections are behind a button, which carries the sign for all of them.

import { cn } from "cn";
import { CircleArrowUpIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Frame, outWords, useFrame } from "@/lib/frame";
import { problemCount } from "@/problems/problem-words";
import { settingAnchor, VERSION } from "@/settings/setting-address";

/** How each kind of mark is drawn: a problem as an alarm, a newer release quieter. */
const SIGNS = {
  problems: { icon: TriangleAlertIcon, look: "text-destructive" },
  update: { icon: CircleArrowUpIcon, look: "text-link" },
} as const;

/** The section whose screen starts an update, and what the mark of a newer release is named there. */
const [UPDATE_HOME, UPDATE_NAME] = ["settings", "update available"] as const;

/** What marks a section. */
interface Mark {
  /** What it is a sign of. */
  readonly kind: keyof typeof SIGNS;

  /** What a screen reader calls it, after the section's name: `2 problems`, or `update available`. */
  readonly name: string;

  /** The hint of the link that carries it: the first problem's sentence, or which release is out. */
  readonly says: string;

  /** The line of the section's screen it is about, by the line's id; left out, the screen as a whole. */
  readonly at?: string;
}

/** What a marked section is drawn from. */
interface MarkedSectionProps {
  /** The section's mark, or `null` for none. */
  readonly mark: Mark | null;

  /** The link the section is drawn as. */
  readonly link: ReactElement;

  /** The section's icon and name. */
  readonly children: ReactNode;
}

/** The mark of a newer release. It is no problem, so it is counted with none. */
function updateMark(update: NonNullable<Frame["update"]>): Mark {
  return { kind: "update", name: UPDATE_NAME, says: outWords(update), at: settingAnchor(VERSION) };
}

/**
 * The mark of one section: the problems its screen holds, and at Settings with none, the newer release that is out.
 *
 * @param section - the section's key, such as `usage`
 */
export function useSectionMark(section: string): Mark | null {
  const { marks, update } = useFrame().data;
  const problems = Object.hasOwn(marks, section) ? marks[section as keyof typeof marks] : null;
  if (problems !== null) return { kind: "problems", name: problemCount(problems.count), says: problems.says };

  return section === UPDATE_HOME && update !== null ? updateMark(update) : null;
}

/**
 * The mark of all sections together: what the button that opens the sections on a phone carries, where no section is in sight. How many problems their screens hold, and with none, the newer release that is out.
 */
export function useSectionsMark(): Pick<Mark, "kind" | "name"> | null {
  const { marks, update } = useFrame().data;
  const count = Object.values(marks).reduce((sum, mark) => sum + (mark?.count ?? 0), 0);
  if (count > 0) return { kind: "problems", name: problemCount(count) };

  return update === null ? null : updateMark(update);
}

/** Draw the sign of a mark. It says nothing to a screen reader: what carries it names it. */
export function MarkSign({ kind, className }: { readonly kind: Mark["kind"]; readonly className?: string }): ReactNode {
  const { icon: Icon, look } = SIGNS[kind];

  return <Icon aria-hidden="true" className={cn(look, className)} />;
}

/** Draw a section's link, with its mark at its end. */
export function MarkedSection({ mark, link, children }: MarkedSectionProps): ReactNode {
  return (
    <Tooltip disabled={mark === null}>
      <TooltipTrigger render={link}>
        {children}
        {mark === null ? null : (
          <span role="img" aria-label={mark.name} className="ml-auto flex shrink-0">
            <MarkSign kind={mark.kind} className="size-3.5" />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {mark?.says}
      </TooltipContent>
    </Tooltip>
  );
}
