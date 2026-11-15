// The address that starts a build of a Worker at Cloudflare: a Deploy Hook of Workers Builds.
//
//   https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<DEPLOY_HOOK_ID>
//
// Cloudflare's page on Deploy Hooks writes the address so and does not say what an id is made of. One path segment of letters, digits, dashes, and underscores is taken as one.

/** The one host a Deploy Hook is at. */
const HOOK_HOST = "api.cloudflare.com";

/** The path of a Deploy Hook: the fixed part, then its id as the last segment. */
const HOOK_PATH = /^\/client\/v4\/workers\/builds\/deploy_hooks\/[A-Za-z0-9_-]{1,128}$/;

/**
 * Say whether an address is a Deploy Hook of Cloudflare.
 *
 * @param address - an `https` address with no user, password, port, or fragment
 * @returns whether it is at Cloudflare's API host, under the Deploy Hooks path, with one id and no query
 */
export function isDeployHook(address: URL): boolean {
  return address.hostname === HOOK_HOST && HOOK_PATH.test(address.pathname) && address.search === "";
}
