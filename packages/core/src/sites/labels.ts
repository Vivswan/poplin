// The site label: a site's name, two dashes, and its id. It is what names a site in a hostname and in a command; a string without the two dashes is a public name instead.

import { type Checked, MAX_NAME_LENGTH, type PublicName, parsePublicName, parseSiteName, type SiteName } from "../names/names";
import { parseSiteId, SITE_ID_LENGTH, type SiteId } from "./ids";

/** What stands between the name and the id. A name never holds it, so a label that holds it is never a public name. */
const SEPARATOR = "--";

/** The longest site label: the longest name, the separator, and an id. */
export const MAX_SITE_LABEL_LENGTH = MAX_NAME_LENGTH + SEPARATOR.length + SITE_ID_LENGTH;

/** What a reference reserves: no site holds a name its install keeps, so the lookup answers for one. */
const NOTHING_RESERVED: ReadonlySet<string> = new Set();

declare const siteLabelBrand: unique symbol;

/** A name, `--`, and an id; made by `siteLabel` alone. */
export type SiteLabel = string & { readonly [siteLabelBrand]: true };

/** What a label names: the site with that id, shown under that name, or whichever site holds that public name. */
export type LabelParts = { readonly kind: "site"; readonly name: SiteName; readonly id: SiteId } | { readonly kind: "public-name"; readonly name: PublicName };

/** What a command was given to name a site: a label's parts, or an id alone. */
type SiteReference = LabelParts | { readonly kind: "id"; readonly id: SiteId };

/**
 * Build the label of a site's address.
 *
 * @returns `<name>--<id>`, which `splitLabel` reads back
 */
export function siteLabel(name: SiteName, id: SiteId): SiteLabel {
  return `${name}${SEPARATOR}${id}` as SiteLabel;
}

/**
 * Split a label into what it names.
 *
 * @param label - a hostname label with its suffix already stripped, in lowercase
 * @param reserved - the names the install's address layout keeps for itself; none is a public name
 * @returns a name and an id for a label that holds `--`, a public name for one that does not, or why it is neither; only the form is checked, not that a site exists
 */
export function splitLabel(label: string, reserved: ReadonlySet<string>): Checked<LabelParts> {
  const separatorAt = label.indexOf(SEPARATOR);

  if (separatorAt === -1) {
    const publicName = parsePublicName(label, reserved);
    if (!publicName.ok) return publicName;

    return { ok: true, value: { kind: "public-name", name: publicName.value } };
  }

  const name = parseSiteName(label.slice(0, separatorAt));
  if (!name.ok) return name;

  const id = parseSiteId(label.slice(separatorAt + SEPARATOR.length));
  if (!id.ok) return id;

  return { ok: true, value: { kind: "site", name: name.value, id: id.value } };
}

/**
 * Read what a command was given to name a site: its label `<name>--<id>`, its id alone, or a public name.
 *
 * Twelve base36 characters are read as an id, though a name may look the same: whoever resolves the reference tries them as an id first and as a public name second.
 *
 * @param raw - the string as typed, in lowercase
 * @returns the reference, or why the string is none; no lookup is made, and no name is reserved
 */
export function siteReference(raw: string): Checked<SiteReference> {
  const id = parseSiteId(raw);
  if (id.ok) return { ok: true, value: { kind: "id", id: id.value } };

  return splitLabel(raw, NOTHING_RESERVED);
}
