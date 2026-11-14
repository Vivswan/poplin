// The hostnames that name this machine itself: a request to one crosses no network.

/** The names a URL gives this machine: the IPv4 and IPv6 loopback addresses as a URL writes them, and `localhost`. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Decide whether a hostname names this machine itself.
 *
 * @param hostname - a hostname as `URL` gives it: lowercase, an IPv6 address in its brackets
 * @returns `true` for `127.0.0.1`, `localhost`, and `[::1]`, and for nothing else
 */
export function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}
