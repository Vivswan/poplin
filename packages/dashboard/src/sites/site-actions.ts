// What is done to a site from the table or its panel: each change is sent, its result is said in one line, and a change that one press can take back offers Undo.

import { answerOf, api, Refused } from "@/lib/api";
import { sayDone, sayRefused, send } from "@/lib/notify";
import { ACCESSES, type Access, type Site } from "@/lib/sites";

/** The changes of a site. Each but `rename` and `remove` answers the site after the change, or `undefined` when it was refused and the refusal was shown. */
export interface SiteActions {
  /** Copies the site's whole link, and says so. */
  readonly copyLink: (site: Site) => Promise<void>;

  /** Sets who can open the site. */
  readonly setAccess: (site: Site, access: Access) => Promise<Site | undefined>;

  /** Answers the site under its new name, or the sentence of the refusal, which the one who asked shows at the field. */
  readonly rename: (site: Site, name: string) => Promise<Site | string>;

  /** Turns one of the site's two switches on or off. */
  readonly setSetting: (site: Site, setting: "search_engines" | "embeddable", on: boolean) => Promise<Site | undefined>;

  /** Makes a kept version the live one; Undo makes the one before live again. */
  readonly makeLive: (site: Site, version: number) => Promise<Site | undefined>;

  /** Gives the site a new link; the old one stops working. */
  readonly newLink: (site: Site) => Promise<Site | undefined>;

  /** Answers whether the site went to the trash. */
  readonly remove: (site: Site) => Promise<boolean>;

  /** Takes the site out of the trash. */
  readonly restore: (site: Site) => Promise<Site | undefined>;
}

/** A sent change of a site: what its route answered, or `undefined` after a refusal that was shown. */
type Sent = Promise<{ readonly site: Site | null } | undefined>;

/**
 * Build the changes of a site.
 *
 * @param onChanged - called after every done change with the site as the change found it and as it left it, so the table and the panel read again and a site that got another label is followed to it
 */
export function siteActions(onChanged: (before: Site, after: Site | null) => void): SiteActions {
  const routes = api.sites[":site"];
  const at = (site: Site): { readonly site: string } => ({ site: site.label });

  /** Wait for a sent change, and say `said` when it is done. */
  const run = async (site: Site, sent: Sent, said: string, undo?: () => void): Promise<Site | undefined> => {
    const done = await sent;
    if (done === undefined) return undefined;

    onChanged(site, done.site);
    sayDone(said, undo === undefined ? undefined : { run: undo });

    return done.site ?? site;
  };

  const restore: SiteActions["restore"] = (site) => run(site, send(routes.restore.$post({ param: at(site), json: {} })), "Restored from the trash.");
  const makeLive: SiteActions["makeLive"] = (site, version) => {
    // Undo makes the version that was live, live again; the Undo it offers in turn comes back to this one.
    const back = (): void => void makeLive({ ...site, live_version: version }, site.live_version);

    return run(site, send(routes["make-live"].$post({ param: at(site), json: { version } })), `Version ${version} is live now.`, back);
  };

  return {
    restore,
    makeLive,
    copyLink: async (site) => {
      try {
        await navigator.clipboard.writeText(site.url);
        sayDone("Link copied.");
      } catch {
        sayRefused("Not copied. Open the site and copy its address.");
      }
    },
    setAccess: (site, access) =>
      run(site, send(routes.access.$post({ param: at(site), json: { access } })), ACCESSES.find((entry) => entry.access === access)?.now ?? "Saved."),
    setSetting: (site, setting, on) => run(site, send(routes.settings.$post({ param: at(site), json: { [setting]: on } })), "Saved."),
    newLink: (site) => run(site, send(routes["new-link"].$post({ param: at(site), json: {} })), "The site has a new link. The old link stopped working."),
    remove: async (site) => {
      const back = (): void => void restore(site);

      return (await run(site, send(routes.delete.$post({ param: at(site), json: {} })), `${site.name} moved to the trash.`, back)) !== undefined;
    },
    rename: async (site, name) => {
      // A refused name is said at its field, where it is corrected, so the sentence goes back to the one who asked.
      try {
        const renamed = await answerOf(routes.rename.$post({ param: at(site), json: { name } }));
        onChanged(site, renamed.site);
        sayDone("Renamed. The link took the new name. The old link keeps working.");

        return renamed.site;
      } catch (error) {
        if (error instanceof Refused) return error.message;

        throw error;
      }
    },
  };
}
