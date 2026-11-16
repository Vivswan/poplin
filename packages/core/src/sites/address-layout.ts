// How an install lays out the addresses of its sites, as it says so to a client that reads a typed address.
//
//   hostname   https://report--k3f9x2ab71qz-p-poplin.example.com/   a site is a hostname under the install's domain
//   path       https://sites.example.net/report--k3f9x2ab71qz/       a site is the first path segment on one of two hosts
// `public_word` is the word the first label of every public-name address ends in. `sites_host` holds the unlisted and the public sites, `private_host` the private ones.
// A host is a hostname in lowercase, with `:<port>` after it when the port is not the scheme's own.

import * as v from "valibot";

import { type PublicWord, parsePublicWord } from "../names/marker";

/** A public word as `parsePublicWord` takes it, so a layout that parsed holds no other. */
const PUBLIC_WORD = v.pipe(
  v.string(),
  v.check((raw) => parsePublicWord(raw) !== undefined),
  v.transform((raw) => raw as PublicWord),
);

/** The layout of an install's site addresses: the public word of its hostnames, or the two hosts of its paths. */
export const ADDRESS_LAYOUT = v.variant("kind", [
  v.object({ kind: v.literal("hostname"), public_word: PUBLIC_WORD }),
  v.object({ kind: v.literal("path"), sites_host: v.string(), private_host: v.string() }),
]);

/** The layout of an install's site addresses, as `whoami` answers it. */
export type AddressLayout = Readonly<v.InferOutput<typeof ADDRESS_LAYOUT>>;
