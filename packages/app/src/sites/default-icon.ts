// Poplin's own icon, which a browser's tab shows for a site that holds no `favicon.ico`.
//
// It is `brand/favicon.svg`, character for character: a module import of the drawing itself gives text in one bundler and an address in another, so the text stands here and a test holds the two alike.

/** The content type the icon goes out with. */
export const DEFAULT_ICON_TYPE = "image/svg+xml";

/** The icon: an SVG drawing that holds no script and names no other file. */
export const DEFAULT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <title>poplin</title>
  <rect x="6" width="10" height="10" rx="1.5" fill="#3B66D6" opacity=".45"/>
  <rect x="3" y="3" width="10" height="10" rx="1.5" fill="#D23C56"/>
  <rect y="6" width="10" height="10" rx="1.5" fill="#3B66D6"/>
</svg>
`;
