// One site, beside the table: its link, who can open it, its facts and versions, the settings it is seldom given, and what is done to the whole of it.

import { showBytes } from "@poplin/core/src/records/settings";
import { CopyIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ACCESSES, type Access, addressParts, expiryOf, shortMoment, showCount, shownName, type Site, wholeMoment } from "@/lib/sites";
import { IconButton } from "@/shared/icon-button";
import { PanelBlock, PanelFact, PanelFacts, PanelLoading, PanelSwitch, SidePanel } from "@/shared/side-panel";
import type { SiteActions } from "@/sites/site-actions";
import { Who } from "@/shared/who";
import { type Reveal, RevealButton, SiteLink } from "@/sites/site-columns";
import { type Shown, useSite } from "@/sites/site-queries";
import type { Ask } from "@/sites/site-questions";

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

  /** Called when a change gave the site another label, with the site as it then is: its panel is at another address. */
  readonly onMoved: (site: Site) => void;
}

/** The site's link: its id is left out until it is shown, with Copy and Open beside it. A public site's other address is written the same way, under the one eye. */
function LinkBlock({ site, actions, reveal }: { readonly site: Site; readonly actions: SiteActions; readonly reveal: Reveal }): ReactNode {
  const whole = reveal.shows(site);
  const also = site.addresses.public === null ? undefined : site.addresses.site;
  const hides = [site.url, ...(also === undefined ? [] : [also])].some((address) => addressParts(address, site.id).hidden !== "");

  return (
    <PanelBlock label="Link">
      <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2.5">
        <SiteLink site={site} whole={whole} />
        <IconButton label="Copy the link" onClick={() => void actions.copyLink(site)}>
          <CopyIcon />
        </IconButton>
        {hides ? <RevealButton site={site} reveal={reveal} /> : null}
        <IconButton label="Open the site" link={<a href={site.url} target="_blank" rel="noreferrer" />}>
          <ExternalLinkIcon />
        </IconButton>
      </div>
      {also === undefined ? null : (
        <p className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
          <span className="shrink-0">It also opens at</span>
          <SiteLink site={site} address={also} whole={whole} />
        </p>
      )}
    </PanelBlock>
  );
}

/** Who can open the site, as a choice of three. A site made more private is changed at once; one opened wider is asked about first. */
function AccessBlock({ site, onChoose }: { readonly site: Site; readonly onChoose: (access: Access) => void }): ReactNode {
  return (
    <PanelBlock label="Who can open it">
      <ToggleGroup
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
      <p className="text-muted-foreground">{ACCESSES.find((entry) => entry.access === site.access)?.means}</p>
    </PanelBlock>
  );
}

function FactsBlock({ site }: { readonly site: Site }): ReactNode {
  return (
    <PanelBlock>
      <PanelFacts>
        <PanelFact name="Views">
          {site.views === null ? "Not known" : `about ${showCount(site.views.today)} today, about ${showCount(site.views.week)} in 7 days`}
        </PanelFact>
        <PanelFact name="Size">
          {showBytes(site.bytes)}, {site.files} {site.files === 1 ? "file" : "files"}
        </PanelFact>
        <PanelFact name="Updated">
          <time title={wholeMoment(site.updated)}>{shortMoment(site.updated)}</time>
        </PanelFact>
        {site.state === "trash" ? null : <PanelFact name="Deletes itself">{expiryOf(site.expires)}</PanelFact>}
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
              <Button variant="outline" size="xs" onClick={() => onMakeLive(version.number)}>
                Make live
              </Button>
            )}
          </li>
        ))}
      </ul>
    </PanelBlock>
  );
}

/** A site in the trash: when it leaves for good, and the way back. */
function TrashBlock({ site, onRestore }: { readonly site: Site; readonly onRestore: () => void }): ReactNode {
  const leaves = site.gone_on === undefined ? "" : ` It leaves the trash for good on ${wholeMoment(site.gone_on)}.`;

  return (
    <PanelBlock label="In the trash">
      <p className="text-muted-foreground">The site comes back with its link and its settings.{leaves}</p>
      <Button className="w-fit" onClick={onRestore}>
        Restore
      </Button>
    </PanelBlock>
  );
}

/** Draw the panel of one site. It reads the site when it opens and after every change. */
export function SitePanel({ label, actions, reveal, onAsk, closeLink, onClose, onMoved }: SitePanelProps): ReactNode {
  const { data, error, isFetching } = useSite(label);
  const failure = error?.message;

  // A site reached under a label it no longer has is shown at the address of the one it has now. Only a fresh answer says so: one kept from before a rename may name a label the site has left again.
  const moved = data !== undefined && !isFetching && data.site.label !== label ? data.site : undefined;
  useEffect(() => {
    if (moved !== undefined) onMoved(moved);
  }, [moved, onMoved]);

  const frame = { closeLink, onClose, back: "Back to sites" };
  const site = data?.site;
  if (site === undefined || data === undefined) {
    return (
      <SidePanel title={failure === undefined ? undefined : "Site"} {...frame}>
        {failure === undefined ? <PanelLoading /> : <p className="px-6 text-muted-foreground max-md:px-4">{failure}</p>}
      </SidePanel>
    );
  }

  const choose = (access: Access): void => {
    const [from, to] = [ACCESSES.findIndex((entry) => entry.access === site.access), ACCESSES.findIndex((entry) => entry.access === access)];
    if (to > from) onAsk(site, { kind: "access", access });
    else if (to < from) void actions.setAccess(site, access);
  };
  const remove = async (): Promise<void> => {
    if (await actions.remove(site)) onClose();
  };

  if (site.state === "trash") {
    return (
      <SidePanel title={shownName(site)} {...frame}>
        <FactsBlock site={site} />
        <TrashBlock site={site} onRestore={() => void actions.restore(site)} />
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
      <PanelBlock label="Settings">
        <PanelSwitch
          id="site-search-engines"
          label="Search engines may list it"
          on={site.search_engines}
          onChange={(on) => actions.setSetting(site, "search_engines", on)}
        />
        <PanelSwitch
          id="site-embeddable"
          label="Other websites may embed it"
          on={site.embeddable}
          onChange={(on) => actions.setSetting(site, "embeddable", on)}
        />
      </PanelBlock>
      <PanelBlock>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => onAsk(site, { kind: "new-link" })}>
            New link
          </Button>
          <Button variant="destructive" className="ml-auto" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </PanelBlock>
    </SidePanel>
  );
}
