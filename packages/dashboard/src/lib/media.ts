// The media queries the client asks the browser about, and how it follows one.

/** The widths of a phone, where a screen's own controls begin right under the header and a result is said at the bottom. */
export const PHONE = "(max-width: 767.98px)";

/** The widths of a screen with room to spare beside the side menu: a table draws there what a narrower screen leaves out. */
export const ROOMY = "(min-width: 1280px)";

/** How the UI library's hook follows a query: the client is drawn in a browser alone, so the first drawing already holds the answer. */
export const IN_BROWSER = { noSsr: true } as const;
