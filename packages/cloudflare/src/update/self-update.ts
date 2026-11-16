// How an install replaces its own code with a release, with the key it keeps and no build anywhere.
//
//   1  the project's website    releases.json: which releases are published, each with the digest of its manifest and its schema
//   2  Cloudflare's API         one small read with the kept key: a key that is absent, refused, or without the right stops here
//   3  the release's page       the manifest, then the built module and its map, each checked against the digest one step up
//   4  Cloudflare's API         the Worker's bindings, read as the last thing before the upload, so one added meanwhile is kept
//   5  Cloudflare's API         one upload, whole or not at all; then the schedule, only when the release's differs
//
// Steps 1 to 3 change nothing: `ready` runs them, and what it answers runs steps 4 and 5.
// Where releases are read from is fixed when the Worker is built: no variable and no setting of a running install moves it.
// No answer, and nothing this file hands on, holds the key or a text Cloudflare sent.

import type { Keyed } from "@poplin/app/src/console/key/records";
import { pickRelease } from "@poplin/core/src/actions/pick-release";
import { type Refused, refuse } from "@poplin/core/src/actions/records";
import type { SelfUpdate } from "@poplin/core/src/actions/start-update";
import { projectReleases, type ReleaseSource } from "../deploy/release-source";
import type { KeptKey } from "../key/kept-key";
import { checkedBundle, type Reach } from "./bundle-files";
import { openUpload, type Upload } from "./upload";

/** What an update is about when Cloudflare gave no usable answer to a call made with the key: `update_unreachable` for an upload that may be in, `release_refused` for a read before anything was sent. */
const HOST = "host";

/** What `version_refused` is about for code that throws as it loads. */
const LOAD = "code";

/** How long the project's website may take to say which releases are published, in milliseconds, where the reader names no time itself. */
const ANSWER_WITHIN = 60_000;

/** What the update is made from. */
interface Parts {
  /** The kept key, or `undefined` on an install that holds none. */
  readonly key: KeptKey | undefined;

  /** The Worker that is replaced: the install's own. */
  readonly worker: { readonly accountId: string; readonly script: string };

  /** The version the install runs. */
  readonly version: string;

  /** Reaches the project's website and the release's page: the platform's own `fetch`, or a stand-in. */
  readonly fetch: Reach["fetch"];
}

/** The release an update is asked to take. */
type Wanted = Parameters<SelfUpdate["ready"]>[0];

/** A release that is ready to be put in place. */
type Ready = Extract<Awaited<ReturnType<SelfUpdate["ready"]>>, { readonly ok: true }>;

/** Why a release is not taken. */
type NotTaken = Exclude<Awaited<ReturnType<SelfUpdate["ready"]>>, Ready>;

/** The refusals of the key, in the codes an update answers with. */
function keyRefusal(refused: Extract<Keyed<never>, { readonly ok: false }>): Refused<"no_key" | "key_refused" | "lacks_right" | "update_unreachable"> {
  if (refused.refusal === "unreachable") return refuse("update_unreachable", HOST);

  return refused.refusal === "lacks_right" ? refuse("lacks_right", refused.right) : refuse(refused.refusal);
}

/** Read which releases are published, and pick the one to take. */
async function published(releases: ReleaseSource, wanted: Wanted, running: string): Promise<Extract<ReturnType<typeof pickRelease>, { readonly ok: true }> | NotTaken> {
  const pins = await releases.pins();
  if (pins === undefined) return refuse("release_refused", "unreachable");

  const picked = pickRelease(pins, wanted, running);
  if (picked.ok) return picked;

  return picked.refusal === "no_update" ? refuse("no_update") : refuse("release_refused", picked.refusal);
}

/** Send the upload of a release's checked files, and answer it in the codes an update answers with. */
async function sent(upload: Upload, bundle: Parameters<Upload["put"]>[0]): ReturnType<Ready["put"]> {
  const answer = await upload.put(bundle);
  if (answer.ok) return answer;

  if (answer.refusal === "needs_hand") return refuse("release_refused", answer.refusal);

  if (answer.refusal === "unread") return refuse("release_refused", HOST);

  if (answer.refusal !== "version_refused") return keyRefusal(answer);

  return refuse("version_refused", answer.load ? LOAD : String(answer.status));
}

/**
 * Make what replaces the install's own code with a release.
 *
 * @returns `ready`, which fetches and checks and changes nothing, and answers the `put` that uploads. A release is taken only when every digest matched; an upload Cloudflare refuses leaves the Worker running what it ran
 */
export function createSelfUpdate(parts: Parts): SelfUpdate {
  const reach: Reach = { fetch: parts.fetch };
  const releases = projectReleases({ fetch: (url, init) => parts.fetch(url, { signal: init.signal ?? AbortSignal.timeout(ANSWER_WITHIN) }) });

  return {
    holdsKey: () => parts.key !== undefined,
    async ready(wanted) {
      const picked = await published(releases, wanted, parts.version);
      if (!picked.ok) return picked;

      const upload = await openUpload(parts.key, parts.worker);
      if (!upload.ok) return keyRefusal(upload);

      const checked = await checkedBundle(reach, picked.version, picked.pin);
      if (!checked.ok) return refuse("release_refused", checked.why);

      return { ok: true, version: picked.version, put: () => sent(upload.value, checked.bundle) };
    },
  };
}
