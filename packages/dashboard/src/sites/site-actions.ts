// What is done to a site from the table or its panel: each change is sent, its result is said in one line, and a change that one press can take back offers Undo.

import { answerOf, api, Refused } from "@/lib/api";
import { copy, sayDone, send, unsay } from "@/lib/notify";
import { ACCESSES, type Access, type Site, shownName } from "@/lib/sites";
import type { NamingRefusal, SiteNaming } from "@/sites/edit-site-dialog";

/** What a site that was made public says. */
const PUBLIC_NOW = ACCESSES.find((entry) => entry.access === "public")?.now ?? "Saved.";

/** The changes of a site. Each but `name`, `makePublic`, and `remove` answers the site after the change, or `undefined` when it was refused and the refusal was shown. */
export interface SiteActions {
  /** Copies the site's whole link, and says so. */
  readonly copyLink: (site: Site) => Promise<void>;

  /** Sets who can open the site. */
  readonly setAccess: (site: Site, access: Access) => Promise<Site | undefined>;

  /** Makes the site public under a public name. Answers nothing when it is done, or the sentence of the refusal, which the one who asked shows at the name's field. */
  readonly makePublic: (site: Site, publicName: string) => Promise<string | undefined>;

  /** Gives the site another title, another name, or both. Answers nothing when it is done, or the refusal, which the one who asked shows at its field. */
  readonly name: (site: Site, naming: SiteNaming) => Promise<NamingRefusal | undefined>;

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

/** The name of the line that says a site went to the trash: the line is taken away under it once its Undo can do nothing, after a restore and after a delete for good. */
export function trashLine(site: Site): string {
  return `trash ${site.id}`;
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
  const run = async (site: Site, sent: Sent, said: string, undo?: Parameters<typeof sayDone>[1]): Promise<Site | undefined> => {
    const done = await sent;
    if (done === undefined) return undefined;

    onChanged(site, done.site);
    sayDone(said, undo);

    return done.site ?? site;
  };

  // A site that is out of the trash again has nothing left to undo: the line that said it went there leaves.
  const restore: SiteActions["restore"] = async (site) => {
    const restored = await run(site, send(routes.restore.$post({ param: at(site), json: {} })), `${shownName(site)} restored.`);
    if (restored !== undefined) unsay(trashLine(site));

    return restored;
  };
  const makeLive: SiteActions["makeLive"] = (site, version) => {
    // Undo makes the version that was live, live again; the Undo it offers in turn comes back to this one.
    const back = (): void => void makeLive({ ...site, live_version: version }, site.live_version);

    return run(site, send(routes["make-live"].$post({ param: at(site), json: { version } })), `Version ${version} is live now.`, { run: back });
  };

  return {
    restore,
    makeLive,
    copyLink: (site) => copy(site.url, { done: "Link copied.", failed: "Not copied. Open the site and copy its address." }),
    setAccess: (site, access) =>
      run(site, send(routes.access.$post({ param: at(site), json: { access } })), ACCESSES.find((entry) => entry.access === access)?.now ?? "Saved."),
    makePublic: async (site, publicName) => {
      try {
        const opened = await answerOf(routes.access.$post({ param: at(site), json: { access: "public", public_name: publicName } }));
        onChanged(site, opened.site);
        sayDone(PUBLIC_NOW);

        return undefined;
      } catch (error) {
        if (error instanceof Refused) return error.message;

        throw error;
      }
    },
    setSetting: (site, setting, on) => {
      // Undo stores what the switch showed before, and says so: as a switch of the Settings screen does.
      const back = (): void => void run(site, send(routes.settings.$post({ param: at(site), json: { [setting]: !on } })), "Put back.");

      return run(site, send(routes.settings.$post({ param: at(site), json: { [setting]: on } })), "Saved.", { run: back });
    },
    newLink: (site) => run(site, send(routes["new-link"].$post({ param: at(site), json: {} })), "The site has a new link. The old link stopped working."),
    remove: async (site) => {
      const back = (): void => void restore(site);

      const name = shownName(site);

      return (await run(site, send(routes.delete.$post({ param: at(site), json: {} })), `${name} moved to the trash.`, { run: back, id: trashLine(site), name })) !== undefined;
    },
    name: async (site, naming) => {
      // A refused value is said at its field, where it is corrected, so the refusal goes back to the one who asked.
      try {
        const named = await answerOf(routes.naming.$post({ param: at(site), json: naming }));
        onChanged(site, named.site);
        sayDone("Saved.");

        return undefined;
      } catch (error) {
        if (error instanceof Refused) return { about: error.about === "title" || error.about === "name" ? error.about : null, sentence: error.message };

        throw error;
      }
    },
  };
}
