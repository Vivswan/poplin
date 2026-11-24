// Where one setting is on the Settings screen, and where the version is: the address that leads to its line, for a link of another screen, and the anchor of the line itself.

/** The Settings screen's own path. */
const PATH = "/settings";

/** What the anchor of every setting's line starts with. */
const ANCHOR = "setting-";

/** What an address names the row of the version by, as it names a setting by its key: the row is no setting, and stands among them. */
export const VERSION = "version";

/**
 * The anchor of a setting's line: the id the line is found under.
 *
 * @param key - the setting's key, such as `max_total_size`
 */
export function settingAnchor(key: string): string {
  return `${ANCHOR}${key}`;
}

/**
 * The setting an anchor names.
 *
 * @param hash - the fragment of an address, without its `#`
 * @returns the setting's key; none for a fragment that is no setting's anchor
 */
export function settingOfAnchor(hash: string): string | undefined {
  return hash.startsWith(ANCHOR) ? hash.slice(ANCHOR.length) : undefined;
}

/**
 * The address of one setting, as a link of the console takes it: `<Link {...settingAddress("max_total_size")}>`.
 *
 * Opening it scrolls the setting's line into view, shades it for a moment, and gives its control the focus.
 */
export function settingAddress(key: string): { readonly to: typeof PATH; readonly hash: string } {
  return { to: PATH, hash: settingAnchor(key) };
}
