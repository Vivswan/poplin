// The check of the way a publish's files go: straight to the bucket by a signed ticket, or through the install, and why.
//
//   the files went      the run knows of the install            the check
//   straight            anything                                passes: the upload key is used
//   through the install it holds no upload key                  passes, and says so
//   through the install this run made the key, or knows nothing passes, and says so: the bucket takes a key two and a half minutes after it is made
//   through the install it holds a key the bucket takes         fails: the install hands out none of its tickets
//   refused, then through the install                           fails, unless this run made the key
//
// It publishes nothing of its own: it watches the run's first publish, of one page. No line it says holds an address, a name, or any part of a key.

import { expect } from "bun:test";

import { type Bench, type Check, Skip } from "../records";

/** Why the check is skipped on a run whose first publish was made before it. */
const NO_PUBLISH = "the run's first publish, which this check watches";

/** What the check says of each way a file went. */
const SAID = {
  direct: "a publish sent its file straight to the bucket by a signed ticket: the upload key is used",
  through: "a publish sent its file through the install",
  refused: "the bucket refused the ticket of a publish's file, and the file went through the install",
} as const;

/** The way the one file of a publish went, by where its sendings went: to the bucket alone, to the install alone, or to the bucket first and to the install after it. A file sent twice to one place went one way. */
function wayOf(sent: { readonly install: number; readonly away: number }): keyof typeof SAID {
  if (sent.away === 0) return "through";

  return sent.install === 0 ? "direct" : "refused";
}

/** The sendings of the one file of the run's first publish, by where each went; none at all where that publish was made before. */
async function watched(bench: Bench): Promise<{ readonly install: number; readonly away: number }> {
  const before = bench.sentFiles();
  await bench.shared("private");
  const after = bench.sentFiles();

  return { install: after.install - before.install, away: after.away - before.away };
}

/** The check of the way a publish's files go. It runs first, so the publish it watches is the run's first. */
export const UPLOAD_CHECKS: readonly Check[] = [
  {
    id: "direct-upload",
    name: "a publish sends its file straight to the bucket where the install holds an upload key the bucket takes, and through the install where it holds none",
    needs: ["token"],
    run: async (bench) => {
      const sent = await watched(bench);
      if (sent.install + sent.away === 0) throw new Skip(NO_PUBLISH);

      // What the run knows the install to lack: no key at all, or no key old enough for the bucket to take.
      const lacks = bench.missing["upload-key"] ?? bench.missing["settled-upload-key"];
      const way = wayOf(sent);
      if (way !== "direct" && lacks === undefined) expect<string>(SAID[way]).toBe(SAID.direct);

      bench.say(way === "direct" ? SAID.direct : `${SAID[way]}: a file goes straight to the bucket with ${lacks}`);
    },
  },
];
