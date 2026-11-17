// The words of the Settings screen against the settings the install has: a name stays a few words, and the note behind a question mark stays one short sentence.

import { describe, expect, test } from "bun:test";

import { SETTING_VALUES } from "@poplin/core/src/records/settings";

import { MOST_ABOUT, wordsOf } from "@/settings/settings-words";

/** The settings the screen shows: every one of the install but the users, which the Access screen changes. */
const KEYS = Object.keys(SETTING_VALUES.entries).filter((key) => key !== "users");

/** A sentence's end inside a note: a second sentence follows it. */
const SECOND_SENTENCE = /[.!?] /;

describe("the words of a setting", () => {
  // Drift: a note would grow back into a paragraph, which a person does not read at a glance; the docs hold what is longer.
  test.each(KEYS)("%s has a note of one short sentence, or none", (key) => {
    const { about } = wordsOf(key);

    expect([about.length <= MOST_ABOUT, SECOND_SENTENCE.test(about)]).toEqual([true, false]);
  });

  // Drift: a name would grow into a clause, which nobody reads at a glance down a list of twenty.
  test.each(KEYS)("%s has a name of two to five words", (key) => {
    const words = wordsOf(key).label.split(" ").length;

    expect(words >= 2 && words <= 5).toBe(true);
  });
});
