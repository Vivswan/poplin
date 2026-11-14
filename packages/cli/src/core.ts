// The core entry of the npm package: the shared rules, re-exported from the modules that define them.
//
// Core is a private workspace package, so its modules are bundled into this entry and never imported at run time.

export { SITE_ACTIONS } from "../../core/src/actions";
export { type Checked, type LabelParts, nameFromEntry, parseSiteName, type SecretName, type SiteName, secretName, splitLabel } from "../../core/src/names/names";
export { applyPrefix, DEFAULT_PREFIX, stripPrefix, type Unprefixed } from "../../core/src/names/prefix";
