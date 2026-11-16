// This pins which published release an update takes. A rule dropped here lets an install go below the version it runs, or take a release that changes the database with nobody asking.

import { describe, expect, test } from "bun:test";

import { NEWEST, pickRelease } from "../../src/actions/pick-release";
import { OWN_SCHEMA } from "../../src/database/open";

/** A digest of the published form. */
const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** One release of this install's own schema, and one that changes the database. */
const [SAME, CHANGED] = [{ source: DIGEST, bundle: DIGEST, schema: OWN_SCHEMA }, { source: DIGEST, bundle: DIGEST, schema: OWN_SCHEMA + 1 }];

/** What a release that is taken answers. */
const taken = (version: string, database = false): unknown => ({ ok: true, version, pin: database ? CHANGED : SAME, database });

/** A refusal. */
const refused = (refusal: string): unknown => ({ ok: false, refusal });

describe("pickRelease", () => {
  const rows: readonly { readonly name: string; readonly pins: Parameters<typeof pickRelease>[0]; readonly version: string; readonly automatic?: true; readonly back?: string; readonly running: string; readonly picked: unknown }[] = [
    { name: "the newest, above the running version", pins: { "0.2.0": SAME, "0.10.0": SAME, "0.9.0": SAME }, version: NEWEST, running: "0.2.0", picked: taken("0.10.0") },
    { name: "the newest, which the install runs", pins: { "0.2.0": SAME }, version: NEWEST, running: "0.2.0", picked: refused("no_update") },
    { name: "the newest, older than the running version", pins: { "0.2.0": SAME }, version: NEWEST, running: "0.3.0", picked: refused("no_update") },
    { name: "the newest, and a website that names no release", pins: {}, version: NEWEST, running: "0.2.0", picked: refused("no_update") },
    { name: "the newest, for a person, when it changes the database", pins: { "0.3.0": CHANGED }, version: NEWEST, running: "0.2.0", picked: taken("0.3.0", true) },
    { name: "the newest, by itself, when it changes the database", pins: { "0.3.0": CHANGED }, version: NEWEST, automatic: true, running: "0.2.0", picked: refused("database") },
    { name: "one version above the running one, by itself", pins: { "0.3.0": SAME, "0.4.0": SAME }, version: "0.3.0", automatic: true, running: "0.2.0", picked: taken("0.3.0") },
    { name: "one version that changes the database, by itself", pins: { "0.3.0": CHANGED }, version: "0.3.0", automatic: true, running: "0.2.0", picked: refused("database") },
    { name: "one version that is not published", pins: { "0.3.0": SAME }, version: "0.9.9", running: "0.2.0", picked: refused("no_digest") },
    { name: "a name every object has, as a version", pins: { "0.3.0": SAME }, version: "constructor", running: "0.2.0", picked: refused("no_digest") },
    { name: "the running version, for a person", pins: { "0.2.0": SAME }, version: "0.2.0", running: "0.2.0", picked: refused("no_update") },
    { name: "the running version, for a person, with a way back", pins: { "0.1.0": SAME, "0.2.0": SAME }, version: "0.2.0", back: "0.1.0", running: "0.2.0", picked: refused("no_update") },
    { name: "the running version, which is not published, for a person", pins: { "0.1.0": SAME }, version: "0.2.0", running: "0.2.0", picked: refused("no_update") },
    { name: "the running version, by itself", pins: { "0.2.0": SAME }, version: "0.2.0", automatic: true, running: "0.2.0", picked: refused("no_update") },
    { name: "one version below the running one, by itself", pins: { "0.1.0": SAME }, version: "0.1.0", automatic: true, running: "0.2.0", picked: refused("no_update") },
    { name: "the version before, of the same schema, for a person", pins: { "0.1.0": SAME }, version: "0.1.0", back: "0.1.0", running: "0.2.0", picked: taken("0.1.0") },
    { name: "the version before, of another schema, for a person", pins: { "0.1.0": CHANGED }, version: "0.1.0", back: "0.1.0", running: "0.2.0", picked: refused("database") },
    { name: "one version below the version before, for a person", pins: { "0.1.0": SAME, "0.2.0": SAME }, version: "0.1.0", back: "0.2.0", running: "0.3.0", picked: refused("no_update") },
    { name: "one version below the version before that is not published, for a person", pins: { "0.2.0": SAME }, version: "0.1.0", back: "0.2.0", running: "0.3.0", picked: refused("no_update") },
    { name: "one version below the running one, with no way back, for a person", pins: { "0.1.0": SAME }, version: "0.1.0", running: "0.2.0", picked: refused("no_update") },
    { name: "the version before, by itself", pins: { "0.1.0": SAME }, version: "0.1.0", automatic: true, back: "0.1.0", running: "0.2.0", picked: refused("no_update") },
    { name: "one version above the running one, for a person, with a way back", pins: { "0.3.0": SAME, "0.4.0": SAME }, version: "0.3.0", back: "0.1.0", running: "0.2.0", picked: taken("0.3.0") },
    { name: "an install that runs no released version", pins: { "0.3.0": SAME }, version: NEWEST, running: "0.3.0-rc.1", picked: refused("no_update") },
  ];

  // Drift: each row is a release that must be taken or left. One read the other way is an install taken below its version, or changed with nobody asking.
  test.each(rows)("$name: $picked", ({ pins, version, automatic, back, running, picked }) => {
    expect<unknown>(pickRelease(pins, { version, automatic: automatic === true, back }, running)).toEqual(picked);
  });
});
