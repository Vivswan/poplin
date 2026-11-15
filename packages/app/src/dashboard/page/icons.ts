// The dashboard's small marks, drawn inline so a page loads nothing for them. Each is 16 by 16 and takes the colour of the text around it.

import { raw } from "hono/html";

import type { Html } from "../records";

function mark(paths: string): Html {
  return raw(`<svg viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`);
}

/** The marks, by what they stand for. `private`, `unlisted`, and `public` are who can open a site. */
export const ICONS = {
  private: mark('<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  unlisted: mark('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6"/>'),
  public: mark('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11"/>'),
  copy: mark('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
  more: mark('<circle cx="3.5" cy="8" r=".9"/><circle cx="8" cy="8" r=".9"/><circle cx="12.5" cy="8" r=".9"/>'),
  down: mark('<path d="M4.5 6.5L8 10l3.5-3.5"/>'),
  close: mark('<path d="M4 4l8 8M12 4l-8 8"/>'),
  rename: mark('<path d="M10.8 3.2l2 2L6 12l-2.6.6L4 10z"/>'),
  sites: mark('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11"/>'),
  access: mark('<circle cx="6" cy="6" r="2.5"/><path d="M1.8 13c.4-2.2 2-3.5 4.2-3.5s3.8 1.3 4.2 3.5M11 3.8a2.3 2.3 0 0 1 0 4.4M12.2 9.8c1.2.5 1.9 1.6 2.1 3.2"/>'),
  activity: mark('<path d="M3 4h10M3 8h10M3 12h6"/>'),
  settings: mark('<path d="M2.5 5h7M12.5 5h1M2.5 11h1M6.5 11h7"/><circle cx="11" cy="5" r="1.5"/><circle cx="5" cy="11" r="1.5"/>'),
} as const;

/** The product's mark: three sheets, one over the other. */
export const BRAND_MARK: Html = raw(
  [
    '<svg viewBox="0 0 64 64" aria-hidden="true">',
    '<rect x="28" y="4" width="32" height="32" rx="8" fill="#3b66d6" opacity=".45"/>',
    '<rect x="16" y="16" width="32" height="32" rx="8" fill="#d23c56"/>',
    '<rect x="4" y="28" width="32" height="32" rx="8" fill="#3b66d6"/>',
    "</svg>",
  ].join(""),
);
