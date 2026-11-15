// The way to save the Activity log as files: every entry the filters keep, the newest first, as comma-separated values or one JSON object a line. A log longer than one file holds is saved a file after another.

import { MOST_IN_FILE } from "@poplin/app/src/console/activity-file";
import { DownloadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { narrowingOf } from "@/activity/activity-queries";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { BOOT } from "@/lib/boot";
import { sayDone, send } from "@/lib/notify";
import { showCount } from "@/lib/sites";

/** The formats of a file, as the menu names them. */
const FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "jsonl", label: "JSON Lines" },
] as const;

/** How many entries one file holds, as the screen writes it. */
const A_FILE = showCount(MOST_IN_FILE);

/** What the screen says after a file that is not the last, and how it names the way to the next: by the count for a file of the whole log, which is full, and as a part for a file of a filtered log, which may end sooner. */
const FILE_WORDS = {
  whole: { done: `Downloaded ${A_FILE}.`, more: `Download the next ${A_FILE}`, next: `Next ${A_FILE}` },
  filtered: { done: "Downloaded a part.", more: "Download the next part", next: "Next part" },
} as const;

/** A format's value. */
type Format = (typeof FORMATS)[number]["value"];

/** The file after the one that was saved: which narrowing it is of, its format, the place it goes on from, and its number. */
interface NextFile {
  readonly of: string;
  readonly format: Format;
  readonly after: string;
  readonly part: number;
}

/** What the menu is drawn from. */
interface DownloadMenuProps {
  /** The query of the address the log is at: the files hold what its filters keep. */
  readonly query: URLSearchParams;

  /** Whether the screen knows that one file holds every entry: nothing is asked of the server before it is saved. */
  readonly fitsOne: boolean;

  /** Whether there is nothing to save. */
  readonly empty: boolean;
}

/** What the address narrows the log to. */
type Narrowing = ReturnType<typeof narrowingOf>;

/** Have the browser save what an address answers: a plain link, pressed. The answer says it is a file to save, so the page stays; the link itself does not, since a browser asks no service worker for a link marked as a download. */
function saveFrom(address: string): void {
  const link = document.createElement("a");
  link.href = address;
  link.click();
}

/**
 * Write the address the server answers a file at.
 *
 * @param file - `after` is the place the file is read from, left out for the newest entry; `part` is the number its name carries, left out for a log of one file
 */
function fileAddress(narrowing: Narrowing, format: Format, file: { readonly after: string | undefined; readonly part: number | undefined }): string {
  return `${BOOT.base}/data${api.activity.download.$path({ query: { format, ...narrowing, after: file.after, part: file.part?.toString() } })}`;
}

/**
 * Ask the server where a file is read from and where the file after it goes on from.
 *
 * @returns `from`, the place the file is read from, and `after`, `null` when the log ends with the file; `undefined` after a refusal, which was said
 */
async function placesOf(narrowing: Narrowing, from: NextFile | undefined): Promise<{ readonly from: string; readonly after: string | null } | undefined> {
  const asked = from === undefined ? narrowing : { ...narrowing, after: from.after };

  return send(api.activity.download.next.$get({ query: asked }));
}

/** Draw the Download button and its menu: the formats, and after a file that did not hold the whole log, the way to the next one. */
export function DownloadMenu({ query, fitsOne, empty }: DownloadMenuProps): ReactNode {
  const narrowing = narrowingOf(query);
  const of = JSON.stringify(narrowing);
  const [kept, keep] = useState<NextFile>();
  // A file of other filters has no next one here.
  const next = kept?.of === of ? kept : undefined;
  const words = FILE_WORDS[Object.keys(narrowing).length === 0 ? "whole" : "filtered"];

  /** Save one file, and say what was saved: with the way to the next file where the log goes on. */
  const save = async (format: Format, from?: NextFile): Promise<void> => {
    // A log known to fit one file is saved at once; any other file first learns whether one follows it.
    const places = fitsOne && from === undefined ? { from: undefined, after: null } : await placesOf(narrowing, from);
    if (places === undefined) return undefined;

    // The file is read from the place its end was counted from: an entry written since is in no file, and none is left out between two.
    const part = from?.part ?? 1;
    saveFrom(fileAddress(narrowing, format, { after: places.from, part: from !== undefined || places.after !== null ? part : undefined }));
    const then = places.after === null ? undefined : { of, format, after: places.after, part: part + 1 };
    keep(then);
    if (then !== undefined) return sayDone(words.done, { label: words.more, run: () => void save(format, then) });

    return sayDone(from === undefined ? "Download started." : "Downloaded the last part.");
  };

  return (
    <span className="flex items-center gap-2">
      {next === undefined ? null : (
        <span className="flex items-center gap-1 text-muted-foreground max-xl:hidden">
          {words.done}
          <Button variant="link" size="sm" className="px-1" onClick={() => void save(next.format, next)}>
            {words.next}
          </Button>
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" aria-label="Download" disabled={empty} />}>
          <DownloadIcon />
          <span className="max-md:hidden">Download</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {next === undefined ? null : (
            <>
              <DropdownMenuItem onClick={() => void save(next.format, next)}>{words.next}</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            {next === undefined ? null : <DropdownMenuLabel>From the newest</DropdownMenuLabel>}
            {FORMATS.map((format) => (
              <DropdownMenuItem key={format.value} onClick={() => void save(format.value)}>
                {format.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
