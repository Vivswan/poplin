// The public keys Access signs its tokens with: jose keeps them in memory and fetches them from the team's certs address.
//
//   keys younger than an hour             ->  used as they are
//   older, or a key id they lack          ->  one fetch, unless the keys were fetched in the last minute
//   a fetch that began in the last minute ->  its answer again, a failure included, so the address is asked once a minute at most

import { createRemoteJWKSet, customFetch, errors, type FetchImplementation, type JWTVerifyGetKey } from "jose";

const CERTS_PATH = "/cdn-cgi/access/certs";
const KEYS_LIFETIME_MS = 60 * 60 * 1000;
const REFETCH_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5 * 1000;

/** Where the keys come from. `teamDomain` is `https://<team>.cloudflareaccess.com`, with no trailing slash. `fetch` may reject; jose follows no redirect and takes status 200 alone. */
interface KeySource {
  readonly teamDomain: string;
  readonly fetch: FetchImplementation;
}

/** One answer of the certs address, read to its end: held as plain values, since a body cannot be read by another request than the one that fetched it. */
interface Answer {
  readonly status: number;
  readonly body: string;
}

/** The team's keys. */
export interface AccessKeys {
  /** The team the keys belong to, which is also the issuer its tokens name. */
  readonly teamDomain: string;

  /** Finds the key a token's header names. It rejects with jose's `JWKSNoMatchingKey` when the keys hold none, `JWKSMultipleMatchingKeys` when they hold several, and `KeysUnavailable` when the keys cannot be had now. */
  readonly find: JWTVerifyGetKey;
}

/** The keys cannot be had now: the certs address failed, answered something that is no key set, or was asked under a minute ago and failed then. */
export class KeysUnavailable extends Error {}

/** A fetch whose answer stands for a minute: whoever asks within it gets that answer and starts no fetch. */
function oncePerMinute(fetch: FetchImplementation): FetchImplementation {
  let asked: { readonly at: number; readonly answer: Promise<Answer> } | undefined;

  return async (url, init) => {
    if (asked === undefined || Date.now() - asked.at >= REFETCH_INTERVAL_MS) {
      const answer = fetch(url, init).then(async (response) => ({ status: response.status, body: await response.text() }));
      asked = { at: Date.now(), answer };
    }

    const { status, body } = await asked.answer;

    return new Response(body, { status });
  };
}

/**
 * Make the holder of one team's keys. Keep one per isolate: the fetch limit lives in it.
 *
 * @returns keys that are fetched at most once a minute, whatever the tokens say
 */
export function accessKeys(source: KeySource): AccessKeys {
  const keys = createRemoteJWKSet(new URL(`${source.teamDomain}${CERTS_PATH}`), {
    cacheMaxAge: KEYS_LIFETIME_MS,
    cooldownDuration: REFETCH_INTERVAL_MS,
    timeoutDuration: FETCH_TIMEOUT_MS,
    [customFetch]: oncePerMinute(source.fetch),
  });

  const find: JWTVerifyGetKey = async (header, token) => {
    try {
      return await keys(header, token);
    } catch (error) {
      // These two say which keys the token's header picks out of keys that are in hand.
      if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error;

      throw new KeysUnavailable(undefined, { cause: error });
    }
  };

  return { teamDomain: source.teamDomain, find };
}
