// The library entry of the npm package.

import manifest from "../package.json" with { type: "json" };

/** The version of this package, as its package.json stated it when the package was built. */
export const VERSION: string = manifest.version;
