// The core entry of the npm package: the shared rules, re-exported from the modules that define them.
//
// Core is a private workspace package, so its modules are bundled into this entry and never imported at run time.

export { SITE_ACTIONS } from "../../core/src/actions";
export { type Checked, nameFromEntry, type PublicName, parsePublicName, parseSiteName, type SiteName } from "../../core/src/names/names";
export { mintSiteId, parseSiteId, type SiteId } from "../../core/src/sites/ids";
export { type LabelParts, type SiteLabel, siteLabel, siteReference, splitLabel } from "../../core/src/sites/labels";
