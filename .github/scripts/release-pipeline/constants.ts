/** The fixed names and bounds of the npm release pipeline. */

/** The workspace folder the published package lives in, relative to the checkout; every npm call runs there. */
export const PACKAGE_DIR = "packages/cli";

/** The file release-please keeps the last released version in. */
export const MANIFEST_FILE = ".release-please-manifest.json";

/** A full commit sha, as GITHUB_SHA carries it. */
export const FULL_SHA = /^[0-9a-f]{40}$/;

/** Trusted publishing (and its provenance) exists from npm 11.5.1 on. */
export const NPM_FLOOR = "11.5.1";

/** Where the package's record is read unless NPM_REGISTRY_URL names another registry, as the tests do. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** The registry reads after a publish: 15 reads 20 s apart hold the lane for up to 280 s. */
export const CONFIRM_READS = 15;

/** The pause between those reads; NPM_CONFIRM_PAUSE_MS overrides it. */
export const CONFIRM_PAUSE_MS = 20_000;

/** The variable GitHub sets in a job granted `id-token: write`; npm's trusted publishing asks it for the token. */
export const OIDC_REQUEST_URL = "ACTIONS_ID_TOKEN_REQUEST_URL";
