// The public keys Access signs its tokens with, held in memory and fetched from the team's certs address under a fetch limit.
//
//   keys younger than an hour          ->  used as they are
//   older, or a key id they lack       ->  one fetch, unless one was started in the last minute

import { createLocalJWKSet, type JSONWebKeySet } from "jose";

const CERTS_PATH = "/cdn-cgi/access/certs";
const KEYS_LIFETIME_MS = 60 * 60 * 1000;
const REFETCH_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5 * 1000;

/** The part of `fetch` the keys need. It may reject; a redirect counts as a failure. */
type CertsFetch = (url: string, init: { readonly redirect: "error"; readonly signal: AbortSignal }) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

/** Finds the key a token's header names; rejects with jose's `JWKSNoMatchingKey` when the set holds none. */
export type KeySet = ReturnType<typeof createLocalJWKSet>;

/** Where the keys come from. `teamDomain` is `https://<team>.cloudflareaccess.com`, with no trailing slash. */
interface KeySource {
  readonly teamDomain: string;
  readonly fetch: CertsFetch;
}

/** What is held between requests. `attemptedAt` is the start of the last fetch, failed ones included. */
interface Held {
  keys: KeySet | undefined;
  fetchedAt: number;
  attemptedAt: number;
  pending: Promise<KeySet | undefined> | undefined;
}

/** The team's keys. Both calls take the time in milliseconds and never reject. */
export interface AccessKeys {
  /** The team the keys belong to, which is also the issuer its tokens name. */
  readonly teamDomain: string;

  /** The keys in hand, fetched first when there are none or they are over an hour old. `undefined` when they cannot be had now. */
  readonly current: (now: number) => Promise<KeySet | undefined>;

  /** Keys fetched because a token named an unknown key id. `undefined` when a fetch began under a minute ago, or failed. */
  readonly refetched: (now: number) => Promise<KeySet | undefined>;
}

async function fetchKeys(source: KeySource): Promise<KeySet | undefined> {
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await source.fetch(`${source.teamDomain}${CERTS_PATH}`, { redirect: "error", signal });
    if (!response.ok) return undefined;

    return createLocalJWKSet((await response.json()) as JSONWebKeySet);
  } catch {
    return undefined;
  }
}

/**
 * Make the holder of one team's keys. Keep one per isolate: the fetch limit lives in it.
 *
 * @returns keys that are fetched at most once a minute, whatever the tokens say
 */
export function accessKeys(source: KeySource): AccessKeys {
  const held: Held = { keys: undefined, fetchedAt: 0, attemptedAt: Number.NEGATIVE_INFINITY, pending: undefined };

  async function refetched(now: number): Promise<KeySet | undefined> {
    if (held.pending !== undefined) return held.pending;

    if (now - held.attemptedAt < REFETCH_INTERVAL_MS) return undefined;

    held.attemptedAt = now;
    held.pending = fetchKeys(source);

    const keys = await held.pending;
    held.pending = undefined;

    if (keys === undefined) return undefined;

    held.keys = keys;
    held.fetchedAt = now;

    return keys;
  }

  async function current(now: number): Promise<KeySet | undefined> {
    const age = now - held.fetchedAt;
    if (held.keys !== undefined && age >= 0 && age < KEYS_LIFETIME_MS) return held.keys;

    return refetched(now);
  }

  return { teamDomain: source.teamDomain, current, refetched };
}
