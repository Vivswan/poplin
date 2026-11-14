/** The one example site the page publishes, wherever its name or address is shown. */
export const EXAMPLE_SITE = "report--k3f9x2ab71qz";

/** The example site's address in parts: its one letter is p while the site is private and u once it is not. */
export const EXAMPLE_ADDRESS = {
  before: `${EXAMPLE_SITE}-`,
  letters: [
    { is: "p", shows: "private" },
    { is: "u", shows: "unlisted public" },
  ],
  after: "-poplin.example.com",
} as const;

/** The address of the example site as it is first published: private. */
export const EXAMPLE_HOST = `${EXAMPLE_ADDRESS.before}p${EXAMPLE_ADDRESS.after}`;

/** The short name the example site gains while it is public. */
export const EXAMPLE_PUBLIC_NAME = "report-page.example.com";

/** The address of the private dashboard that lists the sites. */
export const EXAMPLE_DASHBOARD = "poplin.example.com";

/** Where the website serves the example site that the browser frame shows, relative to the site's base. */
export const EXAMPLE_PAGE_PATH = "sample/sales-report/";
