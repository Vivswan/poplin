// Finish a publish or an import: every declared file is checked to be in the store, then the database row is written, which is the one step that makes the files live.

import type { Actor } from "../auth/scopes";
import type { Signed } from "../database/database";
import type { SettingValues } from "../records/settings";
import { type Site, siteFromRow } from "../records/site";
import { parseUploadId, type Upload, type UploadPlan } from "../records/upload";
import { enterInstall } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, type SiteObject, siteAnswer } from "./site-object";
import { discardUpload, isWithinReach, missingFiles, removeDropped } from "./uploads";

/** The codes a recorded upload is refused with for good: it can never be made live, so its files go. */
type LostCode = "not_found" | "in_trash" | "name_taken" | "stale_version" | "id_taken";

/** The codes finishing may be refused with. */
type FinishCode = LostCode | "not_set_up" | "bad_argument" | "missing_files";

/** The answer to a publish: the site answer with `created` on the site. `left` names the prefixes of dropped versions whose files are not all removed yet; it is empty when all went. */
interface Published extends SiteAnswer {
  readonly site: SiteObject & { readonly created: boolean };
  readonly left: readonly string[];
}

/** An upload made live. `before` is the site it was published onto, `null` for a new site; `dropped` are the versions the site no longer keeps. */
interface Committed {
  readonly ok: true;
  readonly before: Site | null;
  readonly site: Site;
  readonly dropped: readonly number[];
}

/** What a commit is made with: the upload, the install's settings, and the signature of the change. */
interface Commit {
  readonly upload: Upload;
  readonly settings: SettingValues;
  readonly signed: Signed;
}

/** Make the upload's new site. A copy gets one more audit entry, which names the site it was copied from. */
async function makeSite(install: Install, plan: Extract<UploadPlan, { kind: "create" | "duplicate" }>, commit: Commit): Promise<Committed | Refused<LostCode> | "not_pending"> {
  const made = await install.database.publishUploadAsSite(commit.upload.id, plan.site, commit.signed);
  if (made.kind === "not_pending") return "not_pending";

  if (made.kind !== "done") return refuse(made.kind, "public_name");

  if (plan.kind === "duplicate") await install.database.appendAudit({ action: "duplicate", site: made.site, detail: { from: plan.from.id } }, commit.signed);

  return { ok: true, before: null, site: made.site, dropped: [] };
}

/** Store the site an import carries, as its backup held it, under the upload's folder: the database stores the site with every version, or nothing. */
async function importSite(install: Install, plan: Extract<UploadPlan, { kind: "import" }>, commit: Commit): Promise<Committed | Refused<LostCode> | "not_pending"> {
  const imported = await install.database.importUploadAsSite(commit.upload.id, siteFromRow(plan.site), commit.signed);
  if (imported.kind === "done") return { ok: true, before: null, site: imported.site, dropped: [] };

  if (imported.kind === "not_pending") return "not_pending";

  if (imported.kind === "name_taken") return refuse("name_taken", "public_name");

  if (imported.kind === "id_taken") return refuse("id_taken", "id");

  // The folder was minted for this import, so a site in it is a failure and no conflict: the upload stays as it is, with the files under it.
  throw new Error(`the folder minted for import ${commit.upload.id} is a site's`);
}

/** Add the upload as a version, with the settings asked with it: the database makes all of it, or nothing. */
async function addVersion(install: Install, plan: Extract<UploadPlan, { kind: "update" }>, commit: Commit): Promise<Committed | Refused<LostCode> | "not_pending"> {
  const site = await install.database.getSiteByFolder(commit.upload.folder);
  if (site === undefined) return refuse("not_found");

  const { access, details, page_title } = plan;
  const version = { keep: commit.settings.versions_kept, access, details, page_title };
  const added = await install.database.publishUploadAsVersion(commit.upload.id, version, commit.signed);
  if (added.kind === "not_pending") return "not_pending";

  if (added.kind === "stale_number") return refuse("stale_version");

  if (added.kind === "name_taken") return refuse("name_taken", "public_name");

  if (added.kind !== "done") return refuse(added.kind);

  return { ok: true, before: site, site: added.site, dropped: added.dropped };
}

/** Make what the upload was begun for. */
function commitUpload(install: Install, commit: Commit): Promise<Committed | Refused<LostCode> | "not_pending"> {
  const { plan } = commit.upload;
  if (plan.kind === "create" || plan.kind === "duplicate") return makeSite(install, plan, commit);

  if (plan.kind === "import") return importSite(install, plan, commit);

  return addVersion(install, plan, commit);
}

/** Answer for an upload that is live, removing what is left of the versions it dropped as far as one bounded removal goes. */
async function published(install: Install, settings: SettingValues, live: Committed & { readonly upload: Upload; readonly created: boolean }): Promise<Published> {
  const left = await removeDropped(install, live.upload, live.dropped);
  const answer = siteAnswer({ before: live.before, after: live.site }, install, settings);

  return { ...answer, site: { ...answer.site, created: live.created }, left };
}

/** Answer again for an upload that was finished before: the site as it is now, which is also `before` unless the upload made it. */
async function publishedBefore(install: Install, settings: SettingValues, upload: Upload): Promise<Published | Refused<"not_found">> {
  const site = await install.database.getSiteByFolder(upload.folder);
  if (site === undefined) return refuse("not_found");

  const created = upload.plan.kind !== "update";

  return published(install, settings, { ok: true, before: created ? null : site, site, dropped: upload.dropped, upload, created });
}

/**
 * Finish a publish: make the upload's files a new site, or the live version of the site they were uploaded for. An import's files become the site its backup held, under the id it had.
 *
 * Every file of the manifest must be in the store at its declared size. The database row is written last and in one step, so a visitor sees the whole version or nothing of it.
 * Asked again after it succeeded, it answers with the site as it is now and goes on removing the files of the versions the publish dropped.
 * @param reference - the upload's id as sent
 * @returns the site with `created`, and the site as it was before (`null` for a new site). `missing_files` names the first file the store lacks, and leaves the upload pending.
 * Every other refusal changed no site, gives the upload up, and removes its files
 * @throws {Error} the store or the database failed; an upload that was not made live stays pending
 */
export async function finishPublish(install: Install, actor: Actor, reference: string): Promise<Published | Refused<FinishCode>> {
  const id = parseUploadId(reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const { settings, signed } = entered;
  const found = await install.database.getUpload(id);
  const upload = found?.upload;
  if (found === undefined || !isWithinReach(upload, actor, signed.at)) return refuse("not_found", "upload");

  if (upload.state === "finished") return publishedBefore(install, settings, upload);

  const [missing] = await missingFiles(install.store, upload, found.manifest);
  if (missing !== undefined) return refuse("missing_files", missing);

  const committed = await commitUpload(install, { upload, settings, signed });

  // Another request finished the upload, or gave it up, while this one was at work.
  if (committed === "not_pending") {
    const now = await install.database.getUploadFile(id, "");
    if (now?.upload.state !== "finished") return refuse("not_found", "upload");

    return publishedBefore(install, settings, now.upload);
  }

  if (!committed.ok) {
    await discardUpload(install, upload);

    return committed;
  }

  return published(install, settings, { ...committed, upload, created: upload.plan.kind !== "update" });
}
