// One site, over the end of the table: its link, who can open it, its facts and versions, the files of its live version, the settings it is seldom given, and what is done to the whole of it.

import { ScrollArea as ScrollAreaParts } from "@base-ui/react/scroll-area";
import { showBytes } from "@poplin/core/src/records/settings";
import { CatchBoundary, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRightIcon, CopyIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { lazy, type ReactElement, type ReactNode, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Refused } from "@/lib/api";
import { ACCESSES, type Access, addressParts, fileAddress, type Site, shortMoment, showCount, shownName, wholeMoment } from "@/lib/sites";
import { settingAddress } from "@/settings/setting-address";
import { IconButton } from "@/shared/icon-button";
import { useOnePress } from "@/dialog/one-press";
import { PanelBlock, PanelFact, PanelFacts, PanelLoading, PanelSwitch, SidePanel } from "@/shared/side-panel";
import { Who } from "@/shared/who";
import { DeleteForGood } from "@/sites/delete-for-good/delete-for-good";
import { ExpiryRow } from "@/sites/expiry/expiry-row";
import type { SiteActions } from "@/sites/site-actions";
import { type Reveal, RevealButton, SiteLink } from "@/sites/site-columns";
import { type FolderRead, type Shown, siteFilesKey, useSite, useSiteFolder, useSiteFolderRead } from "@/sites/site-queries";
import type { Ask } from "@/sites/site-questions";

/** What stands under the switch for embedding: the two things it decides, which its label names one of. */
const EMBEDDING_NOTE = "Other pages may show this site in a frame and load its files.";

/** The code of the refusal that says no site is at a label. */
const GONE = "not_found";

/** What joins the parts of a file's path. A folder's row in the tree is named by its path and one after it, and the row that reads on by one and the folder's path: no file's path ends or begins with one. */
const SEPARATOR = "/";

/** What is said where the tree's own code did not arrive. */
const TREE_NOT_LOADED = "The files did not load. Check the connection, then try again.";

/** How high the room of the tree may be: eight rows of 28 px, or of 40 px where a finger presses them. A longer tree scrolls in it. */
const TREE_ROOM = "*:data-[slot=scroll-area-viewport]:max-h-56 max-md:*:data-[slot=scroll-area-viewport]:max-h-80";

/** An item of the tree. The keys move the focus from item to item, and it is drawn around the item's own row, not around the rows inside it. */
const TREE_ITEM = "outline-none [&:focus-visible>[data-slot=tree-label]]:ring-2 [&:focus-visible>[data-slot=tree-label]]:ring-ring/50";

/** A row of the tree: a folder, a file, or the row that reads on. Each can be pressed, so each shows the hand. */
const TREE_ROW = "flex min-h-7 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-xs hover:bg-muted max-md:min-h-10";

/** A sentence in the tree, where the rows of a folder would be: why the folder could not be read. */
const TREE_SAYS = "px-1.5 py-1 text-muted-foreground";

/** The room a folder's arrow takes before its name: a row without one starts after as much. */
const ARROW_ROOM = "size-4 shrink-0";

/** The widths of the grey lines that stand for the tree while it is read. */
const WAITING_ROWS = ["w-2/5", "w-3/5", "w-1/2"];

/** The tree of a site's files, with the parts of its library. The library is a file of its own, which a browser loads when the tree is first drawn: at the first opening of Files. */
const FilesTree = lazy(async () => {
  const parts = await import("@ui-sdk/react/tree");

  return { default: (props: FilesTreeProps) => <DrawnTree {...props} parts={parts} /> };
});

/** The parts of the tree, as its library hands them out. */
type TreeParts = typeof import("@ui-sdk/react/tree");

/** What the panel is drawn from. */
interface SitePanelProps {
  /** The label of the site to show, from the address. */
  readonly label: string;

  /** The changes of a site. */
  readonly actions: SiteActions;

  /** Which sites show the id in their link, and the switch of one. */
  readonly reveal: Reveal;

  /** Asks a question about the site before a change: the screen draws it. */
  readonly onAsk: (site: Site, ask: Ask) => void;

  /** The link Close is drawn as: it leads back to the table. */
  readonly closeLink: ReactElement;

  /** Closes the panel. */
  readonly onClose: () => void;

  /** Finds the row of the site in the list: it takes the focus when the panel closes. */
  readonly opener: () => HTMLElement | undefined;

  /** Called when a change gave the site another label, with the site as it then is: its panel is at another address. */
  readonly onMoved: (site: Site) => void;
}

/** How to read on in each folder that holds more than was read, by the value of the row that says so. The row tells the tree how as it is drawn, and the tree runs it when the row is pressed. */
type ReadsOn = Map<string, () => Promise<unknown>>;

/** What one folder of the tree is drawn from. */
interface FolderProps {
  /** The parts of the tree. */
  readonly parts: TreeParts;

  /** The site whose files these are. */
  readonly site: Site;

  /** The folder's path in the live version; empty for the top. */
  readonly path: string;

  /** How to read on in this folder and in the folders in it. */
  readonly more: ReadsOn;

  /** Gives the focus to a row of the tree, by the row's value. */
  readonly focus: (value: string) => void;
}

/** What the tree of a site's files is drawn from. */
interface FilesTreeProps {
  /** The site whose files these are. */
  readonly site: Site;

  /** The top folder, as far as it is read. */
  readonly top: FolderRead;

  /** The folders that are open, each by its row's value. They are kept outside the tree, so it is as it was when the block is folded and opened again. */
  readonly opened: string[];

  /** Called with the open folders when one is opened or closed. */
  readonly onOpened: (opened: string[]) => void;
}

/** The site's link: its id is left out until it is shown, with Copy and Open beside it. A public site's other address is written the same way, under the one eye. */
function LinkBlock({ site, actions, reveal }: { readonly site: Site; readonly actions: SiteActions; readonly reveal: Reveal }): ReactNode {
  const whole = reveal.shows(site);
  const also = site.addresses.public === null ? undefined : site.addresses.site;
  const hides = [site.url, ...(also === undefined ? [] : [also])].some((address) => addressParts(address, site.id).hidden !== "");

  return (
    <PanelBlock label="Link">
      <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2.5">
        <SiteLink site={site} whole={whole} wraps />
        {hides ? <RevealButton site={site} reveal={reveal} /> : null}
        <IconButton label="Copy the link" onClick={() => void actions.copyLink(site)}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Open the site" link={<a href={site.url} target="_blank" rel="noreferrer" />}>
          <ExternalLinkIcon />
        </IconButton>
      </div>
      {also === undefined ? null : (
        <p className="text-muted-foreground">
          It also opens at <SiteLink site={site} address={also} whole={whole} wraps />
        </p>
      )}
    </PanelBlock>
  );
}

/** Who can open the site, as a choice of three. Each change is asked about first: it gives the site another link, or ends one. */
function AccessBlock({ site, onChoose }: { readonly site: Site; readonly onChoose: (access: Access) => void }): ReactNode {
  const meansId = useId();

  return (
    <PanelBlock label="Who can open it">
      <ToggleGroup
        aria-label="Who can open it"
        aria-describedby={meansId}
        value={[site.access]}
        onValueChange={(value) => (value[0] === undefined ? undefined : onChoose(value[0] as Access))}
        variant="outline"
        spacing={0}
        className="w-full"
      >
        {ACCESSES.map((entry) => (
          <ToggleGroupItem key={entry.access} value={entry.access} className="flex-1 aria-pressed:bg-chosen aria-pressed:font-bold">
            {entry.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p id={meansId} className="text-muted-foreground">
        {ACCESSES.find((entry) => entry.access === site.access)?.means}
      </p>
    </PanelBlock>
  );
}

/** Word a count of visits. A count is an estimate, so it says "about", but for none: "about 0" reads as a slip. */
function aboutCount(count: number): string {
  return count === 0 ? "0" : `about ${showCount(count)}`;
}

function FactsBlock({ site }: { readonly site: Site }): ReactNode {
  return (
    <PanelBlock>
      <PanelFacts>
        <PanelFact name="Visits">{site.views === null ? "Not known" : `${aboutCount(site.views.today)} today, ${aboutCount(site.views.week)} in 7 days`}</PanelFact>
        <PanelFact name="Size">
          {showBytes(site.bytes)}, {site.files} {site.files === 1 ? "file" : "files"}
        </PanelFact>
        <PanelFact name="Updated">
          <time title={wholeMoment(site.updated)}>{shortMoment(site.updated)}</time>
        </PanelFact>
        {site.state === "trash" ? null : <ExpiryRow site={site} />}
      </PanelFacts>
    </PanelBlock>
  );
}

/** The kept versions, the newest first, each with who published it. */
function VersionsBlock({ shown, onMakeLive }: { readonly shown: Shown; readonly onMakeLive: (version: number) => void }): ReactNode {
  const { site, logins } = shown;
  const newestFirst = [...site.versions].sort((left, right) => right.number - left.number);

  return (
    <PanelBlock label="Versions">
      <ul className="flex flex-col">
        {newestFirst.map((version) => (
          <li key={version.number} className="flex h-9 items-center gap-3 max-md:h-11">
            <span className="w-7 font-mono text-xs">v{version.number}</span>
            <time title={wholeMoment(version.published)} className="w-24 shrink-0 text-muted-foreground">
              {shortMoment(version.published)}
            </time>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <Who by={version.published_by} logins={logins} />
            </span>
            {version.number === site.live_version ? (
              <Badge variant="secondary">Live</Badge>
            ) : (
              <Button variant="outline" size="xs" aria-label={`Make live: version ${version.number}`} onClick={() => onMakeLive(version.number)}>
                Make live
              </Button>
            )}
          </li>
        ))}
      </ul>
    </PanelBlock>
  );
}

/** What a file or a folder is called in its row: the last part of its path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf(SEPARATOR) + 1);
}

/** The grey lines that stand for the tree while its code and its top folder are read. */
function FilesWaiting(): ReactNode {
  return (
    <div className="flex flex-col gap-2 px-1.5 py-1.5" aria-busy="true">
      {WAITING_ROWS.map((width) => (
        <Skeleton key={width} className={cn("h-4", width)} />
      ))}
    </div>
  );
}

/**
 * The last row of a folder that holds more than was read: a press reads on.
 *
 * It tells the tree how as it is drawn, not after: a press may come before a later effect has run, and would find nothing to run.
 */
function MoreRow({ parts, path, more, focus, read, above }: FolderProps & { readonly read: FolderRead; readonly above: string | undefined }): ReactNode {
  const { TreeItem, TreeItemLabel } = parts;
  const { fetchNextPage } = read;
  const value = `${SEPARATOR}${path}`;
  useLayoutEffect(() => {
    more.set(value, () => {
      // This row leaves once the folder is read whole, and the focus of a row that left goes to the top of the tree. It moves to the row above first: the new files follow that row, and new folders stand with the folders above.
      if (above !== undefined) focus(above);

      // A press that comes while the page is on its way waits for that page, and asks for no second one.
      return fetchNextPage({ cancelRefetch: false });
    });

    return () => void more.delete(value);
  }, [more, value, focus, above, fetchNextPage]);

  return (
    <TreeItem value={value} className={TREE_ITEM}>
      <TreeItemLabel className={cn(TREE_ROW, "font-sans text-link")}>
        {(state) => (
          <>
            <span className={cn(ARROW_ROOM, "flex items-center justify-center")}>{state.pending ? <Spinner className="size-3" /> : null}</span>
            Show more
          </>
        )}
      </TreeItemLabel>
    </TreeItem>
  );
}

/**
 * The rows of one folder, as far as it is read: its folders, then its files, each a link to that file of the site, and last the row that reads on where the folder holds more.
 *
 * A following page that could not be read is told under the rows, in the server's sentence; the row that reads on stays, and reads it again.
 */
function FolderRows({ parts, site, path, more, focus, read }: FolderProps & { readonly read: FolderRead }): ReactNode {
  const { TreeItem, TreeItemLabel } = parts;
  const { data, error, hasNextPage } = read;
  if (data === undefined) return null;

  const folders = data.pages.flatMap((page) => page.folders.map((inside) => ({ path: inside, value: `${inside}${SEPARATOR}` })));
  const files = data.pages.flatMap((page) => page.files);
  const last = files.at(-1)?.path ?? folders.at(-1)?.value;

  return (
    <>
      {folders.map((inside) => (
        <FolderItem key={inside.value} parts={parts} site={site} path={inside.path} more={more} focus={focus} />
      ))}
      {files.map((file) => (
        <TreeItem key={file.path} value={file.path} label={nameOf(file.path)} className={TREE_ITEM}>
          <TreeItemLabel render={<a href={fileAddress(site.url, file.path)} target="_blank" rel="noreferrer" />} className={cn(TREE_ROW, "group/file")}>
            <span className={ARROW_ROOM} />
            <span className="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap group-hover/file:underline">{nameOf(file.path)}</span>
            <span className="shrink-0 font-sans text-muted-foreground tabular-nums">{showBytes(file.size)}</span>
          </TreeItemLabel>
        </TreeItem>
      ))}
      {hasNextPage ? <MoreRow parts={parts} site={site} path={path} more={more} focus={focus} read={read} above={last} /> : null}
      {error === null ? null : <p className={TREE_SAYS}>{error.message}</p>}
    </>
  );
}

/**
 * One folder in the tree: its row, and under it what the folder holds once that was read.
 *
 * The tree asks for a folder to be read when it is first opened, and opens it once it was. One that could not be read stays closed over the server's sentence, and the next press reads it again.
 */
function FolderItem({ parts, site, path, more, focus }: FolderProps): ReactNode {
  const { TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel } = parts;
  const read = useSiteFolder(site, path, false);
  const { data, error } = read;

  return (
    <TreeItem value={`${path}${SEPARATOR}`} branch className={TREE_ITEM}>
      <TreeItemLabel className={TREE_ROW}>
        <TreeItemIndicator className={cn(ARROW_ROOM, "flex items-center justify-center")}>
          {(state) => (state.loading ? <Spinner className="size-3" /> : <ChevronRightIcon aria-hidden="true" className={cn("size-3.5 transition-transform", state.expanded && "rotate-90")} />)}
        </TreeItemIndicator>
        <span className="min-w-0 wrap-anywhere whitespace-pre-wrap">{`${nameOf(path)}${SEPARATOR}`}</span>
      </TreeItemLabel>
      {data === undefined ? null : (
        <TreeGroup className="pl-4">
          <FolderRows parts={parts} site={site} path={path} more={more} focus={focus} read={read} />
        </TreeGroup>
      )}
      {data === undefined && error !== null ? <p className={cn(TREE_SAYS, "pl-7")}>{error.message}</p> : null}
    </TreeItem>
  );
}

/** What stands in for the tree when its code did not load: that it did not, and the way to load the page again, which also brings the code of a newer version. */
function TreeNotLoaded(): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-muted-foreground">{TREE_NOT_LOADED}</p>
      <Button variant="outline" size="xs" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </div>
  );
}

/** The tree of a site's files, in a room that scrolls. A press or Enter on a folder opens it, on a file opens that file of the site in a new tab, and on the last row of a folder that holds more reads on. */
function DrawnTree({ parts, site, top, opened, onOpened }: FilesTreeProps & { readonly parts: TreeParts }): ReactNode {
  const { Tree } = parts;
  const [more] = useState<ReadsOn>(() => new Map());
  const [controller] = useState(() => parts.createTreeController());
  const readFolder = useSiteFolderRead(site);
  const [first] = top.data?.pages ?? [];
  if (first === undefined) return top.error === null ? <FilesWaiting /> : <p className="text-muted-foreground">{top.error.message}</p>;

  if (first.folders.length === 0 && first.files.length === 0 && first.next === null) return <p className="text-muted-foreground">No files.</p>;

  return (
    <ScrollArea className={cn("rounded-md border", TREE_ROOM)}>
      <ScrollAreaParts.Content>
        <Tree
          aria-label="Files"
          mode="none"
          className="flex flex-col p-1"
          expanded={opened}
          onExpandedChange={onOpened}
          controller={controller}
          loadChildren={(value) => readFolder(value.slice(0, -SEPARATOR.length))}
          onAction={(value) => more.get(value)?.()}
        >
          <FolderRows parts={parts} site={site} path="" more={more} focus={controller.focus} read={top} />
        </Tree>
      </ScrollAreaParts.Content>
    </ScrollArea>
  );
}

/**
 * The files of the live version as a tree of its folders, folded away until it is asked for.
 *
 * Nothing is read before: the first opening reads the top folder and loads the tree's code, and a folder is read when it is opened.
 */
function FilesBlock({ site }: { readonly site: Site }): ReactNode {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const top = useSiteFolder(site, "", open);
  const total = top.data?.pages[0]?.total;

  return (
    <PanelBlock>
      <Collapsible open={open} onOpenChange={setOpen}>
        <h3>
          <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="group/files -ml-2 text-muted-foreground max-md:min-h-10" />}>
            <ChevronRightIcon className="transition-transform group-data-[panel-open]/files:rotate-90" />
            Files
            {total === undefined ? null : <span className="font-normal text-faint tabular-nums">{showCount(total)}</span>}
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          <CatchBoundary getResetKey={() => site.id} errorComponent={TreeNotLoaded}>
            <Suspense fallback={<FilesWaiting />}>
              <FilesTree site={site} top={top} opened={opened} onOpened={setOpened} />
            </Suspense>
          </CatchBoundary>
        </CollapsibleContent>
      </Collapsible>
    </PanelBlock>
  );
}

/** What stands under the switch for search engines while it changes nothing: the install keeps search engines out of every site, which is said with the way to that setting, or the site is not public. Where both hold, the install's is said alone. */
function searchNote({ open, allowed }: { readonly open: boolean; readonly allowed: boolean }): ReactNode | undefined {
  if (open && allowed) return undefined;

  if (allowed) return "Only a public site is listed.";

  return (
    <>
      Off for every site in{" "}
      <Link {...settingAddress("search_engines_allowed")} className="rounded-sm text-link underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
        Settings
      </Link>
      .
    </>
  );
}

/** A site in the trash: when it leaves for good, the way back, and the way out at once. */
function TrashBlock({ site, onRestore, onGone }: { readonly site: Site; readonly onRestore: () => Promise<unknown>; readonly onGone: () => void }): ReactNode {
  const { press, busy } = useOnePress(onRestore);
  const leaves = site.gone_on === undefined ? "" : ` It leaves the trash for good on ${wholeMoment(site.gone_on)}.`;

  return (
    <PanelBlock label="In the trash">
      <p className="text-muted-foreground">The site comes back with its link and its settings.{leaves}</p>
      <div className="flex items-center gap-2">
        <Button disabled={busy} onClick={press}>
          Restore
        </Button>
        <span className="ml-auto">
          <DeleteForGood site={site} onGone={onGone} />
        </span>
      </div>
    </PanelBlock>
  );
}

/** Draw the panel of one site. It reads the site when it opens and after every change. */
export function SitePanel({ label, actions, reveal, onAsk, closeLink, onClose, opener, onMoved }: SitePanelProps): ReactNode {
  const { data, error, isFetching } = useSite(label);
  const failure = error?.message;

  // A site reached under a label it no longer has is shown at the address of the one it has now. Only a fresh answer says so: one kept from before a rename may name a label the site has left again.
  const moved = data !== undefined && !isFetching && data.site.label !== label ? data.site : undefined;
  useEffect(() => {
    if (moved !== undefined) onMoved(moved);
  }, [moved, onMoved]);

  // A site that was shown here and is then no longer there, deleted for good in this tab or another, leaves no panel behind. An address that never named a site keeps its sentence.
  const shown = useRef(false);
  if (data !== undefined) shown.current = true;

  const gone = shown.current && error instanceof Refused && error.code === GONE;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  const frame = { closeLink, onClose, opener, back: "Back to sites" };
  const site = data?.site;
  if (site === undefined || data === undefined) {
    return (
      <SidePanel title={failure === undefined ? undefined : "Site"} {...frame}>
        {failure === undefined ? <PanelLoading /> : <p className="px-6 text-muted-foreground max-md:px-4">{failure}</p>}
      </SidePanel>
    );
  }

  const choose = (access: Access): void => {
    if (access !== site.access) onAsk(site, { kind: "access", access });
  };
  const remove = async (): Promise<void> => {
    if (await actions.remove(site)) onClose();
  };

  if (site.state === "trash") {
    return (
      <SidePanel title={shownName(site)} {...frame}>
        <FactsBlock site={site} />
        <TrashBlock site={site} onRestore={() => actions.restore(site)} onGone={onClose} />
      </SidePanel>
    );
  }

  const editButton = (
    <IconButton label="Edit" onClick={() => onAsk(site, { kind: "naming" })}>
      <PencilIcon />
    </IconButton>
  );

  return (
    <SidePanel title={shownName(site)} beside={editButton} {...frame}>
      <LinkBlock site={site} actions={actions} reveal={reveal} />
      <AccessBlock site={site} onChoose={choose} />
      <FactsBlock site={site} />
      <VersionsBlock shown={data} onMakeLive={(number) => void actions.makeLive(site, number)} />
      {/* Other files are another tree: it starts folded, with nothing read and no folder open. */}
      <FilesBlock key={siteFilesKey(site)} site={site} />
      <PanelBlock label="Settings">
        <PanelSwitch
          id="site-search-engines"
          label="Show in search engines"
          on={site.search_engines}
          onChange={(on) => actions.setSetting(site, "search_engines", on)}
          note={searchNote({ open: site.access === "public", allowed: data.search_engines_allowed })}
        />
        <PanelSwitch
          id="site-embeddable"
          label="Allow embedding"
          on={site.embeddable}
          onChange={(on) => actions.setSetting(site, "embeddable", on)}
          note={EMBEDDING_NOTE}
        />
      </PanelBlock>
      <PanelBlock>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => onAsk(site, { kind: "new-link" })}>
            New link
          </Button>
          <Button variant="outline" onClick={() => onAsk(site, { kind: "duplicate" })}>
            Duplicate
          </Button>
          <Button variant="destructive" className="ml-auto" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </PanelBlock>
    </SidePanel>
  );
}
